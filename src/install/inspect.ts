import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Agent } from "../config/types.ts";
import { AGENTS, HARNESSES } from "../modules/harness/api.ts";
import { IntegrationConflict } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { hash } from "../util/hash.ts";
import { withCurrentExecutable } from "./hook-command.ts";
import { type Receipt, validateReceipt } from "./receipt.ts";
import {
  hookFormat,
  type InstallationScope,
  integrationTarget,
  isMarked,
} from "./targets.ts";
import {
  parseObject,
  readIntegrationFile,
  readIntegrationLink,
} from "./transaction.ts";

type Status =
  | "installed"
  | "missing"
  | "modified"
  | "outdated"
  | "unmanaged"
  | "unverified";
type Component = { path: string; status: Status; legacyCheckout?: boolean };
type ReceiptState = "valid" | "missing" | "invalid" | "unreadable";

function read(path: string): { text: string | null; readable: boolean } {
  try {
    return { text: readIntegrationFile(path), readable: true };
  } catch {
    return { text: null, readable: false };
  }
}

function receiptAt(path: string): { state: ReceiptState; receipt?: Receipt } {
  const { text, readable } = read(path);
  if (!readable) return { state: "unreadable" };
  if (text === null) return { state: "missing" };
  try {
    const value: unknown = JSON.parse(text);
    if (validateReceipt(value)) return { state: "valid", receipt: value };
  } catch {
    // Invalid receipt contents cannot establish ownership.
  }
  return { state: "invalid" };
}

function inspectFile(
  path: string,
  expected: string,
  agent: Agent,
  receipt: Receipt | undefined,
  reliable: boolean,
): Component {
  const linkPath = dirname(path);
  const linked = receipt?.files[linkPath];
  const reportedPath = linked ? linkPath : path;
  let contentPath = path;
  if (linked) {
    // A Claude skill installed as a symlink to the shared .agents copy.
    let target: string | null;
    try {
      target = readIntegrationLink(linkPath);
    } catch (error) {
      return {
        path: reportedPath,
        status:
          error instanceof IntegrationConflict ? "modified" : "unverified",
      };
    }
    if (target === null) return { path: reportedPath, status: "missing" };
    if (!linked.owners.includes(agent))
      return { path: reportedPath, status: "unmanaged" };
    if (hash(`symlink:${target}`) !== linked.hash)
      return { path: reportedPath, status: "modified" };
    contentPath = resolve(dirname(linkPath), target, "SKILL.md");
  }
  const { text, readable } = read(contentPath);
  const owned = receipt?.files[contentPath];
  let status: Status;
  if (!readable || !reliable) status = "unverified";
  else if (text === null) status = "missing";
  else if (!owned?.owners.includes(agent)) status = "unmanaged";
  else if (hash(text) !== owned.hash) status = "modified";
  // Our own earlier content that a package upgrade superseded; setup hooks repairs it.
  else if (hash(expected) !== owned.hash) status = "outdated";
  else status = "installed";
  return { path: reportedPath, status };
}

function inspectHook(
  runtime: Runtime,
  path: string,
  agent: Agent,
  receipt: Receipt | undefined,
  reliable: boolean,
): { hook: Component; disableAllHooks?: boolean } {
  const { text, readable } = read(path);
  if (!readable || !reliable) return { hook: { path, status: "unverified" } };
  if (text === null) return { hook: { path, status: "missing" } };
  try {
    const value = parseObject(text, path);
    const hooks = value.hooks;
    if (
      hooks !== undefined &&
      (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    )
      throw new Error("Invalid hooks");
    const format = hookFormat(runtime, agent);
    const groups =
      (hooks as Record<string, unknown> | undefined)?.[format.event] ?? [];
    if (
      !Array.isArray(groups) ||
      groups.some((group) => format.commands(group) === null)
    )
      throw new Error("Invalid hook groups");
    const owned = receipt?.hooks[agent];
    const marked = groups.filter((group) => isMarked(format, group));
    const legacyCheckout = marked.some((group) =>
      format
        .commands(group)
        ?.some(
          (command) =>
            typeof command === "string" &&
            command.includes("/dist/bin/degreaser-axi.js") &&
            withCurrentExecutable(runtime, command) === format.command,
        ),
    );
    const matches =
      owned?.path === path
        ? groups.filter((group) => isDeepStrictEqual(group, owned.group))
        : [];
    let status: Status;
    if (!owned || owned.path !== path)
      status = marked.length ? "unmanaged" : "missing";
    else if (matches.length === 1 && marked.length === 1)
      status = format.commands(owned.group)?.includes(format.command)
        ? "installed"
        : "outdated";
    else if (marked.length || matches.length) status = "modified";
    else status = "missing";
    return {
      hook: {
        path,
        status,
        ...(legacyCheckout ? { legacyCheckout: true } : {}),
      },
      ...(HARNESSES[agent].integration.skill === "native" &&
      typeof value.disableAllHooks === "boolean"
        ? { disableAllHooks: value.disableAllHooks }
        : {}),
    };
  } catch {
    return { hook: { path, status: "unverified" } };
  }
}

export function inspectIntegrations(runtime: Runtime, repository: string) {
  const results = [];
  for (const scope of ["project", "user"] as const) {
    const receipt = receiptAt(
      join(
        scope === "project" ? repository : runtime.home,
        ".degreaser/integrations.json",
      ),
    );
    const reliable = receipt.state === "valid" || receipt.state === "missing";
    for (const harness of AGENTS) {
      const target = integrationTarget(runtime, harness, repository, scope);
      const files = [...target.files].map(([path, expected]) =>
        inspectFile(path, expected, harness, receipt.receipt, reliable),
      );
      const hookInfo = target.hookPath
        ? inspectHook(
            runtime,
            target.hookPath,
            harness,
            receipt.receipt,
            reliable,
          )
        : undefined;
      const statuses = [
        ...files.map((file) => file.status),
        ...(hookInfo ? [hookInfo.hook.status] : []),
      ];
      const status =
        (
          [
            "unverified",
            "modified",
            "unmanaged",
            "missing",
            "outdated",
            "installed",
          ] as const
        ).find((candidate) => statuses.includes(candidate)) ?? "unverified";
      results.push({
        harness,
        scope: scope as InstallationScope,
        status,
        receipt: receipt.state,
        files,
        ...hookInfo,
        activation: `Unverified: ${target.activation}`,
      });
    }
  }
  return results;
}
