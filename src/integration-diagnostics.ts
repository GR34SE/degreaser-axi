import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AGENTS, type Agent } from "./config.ts";
import {
  readIntegrationFile,
  readIntegrationLink,
} from "./integration-files.ts";
import {
  hookFormat,
  type InstallationScope,
  integrationTarget,
  isMarked,
} from "./integration-targets.ts";
import { type Receipt, validateReceipt } from "./integrations.ts";
import { hash } from "./prompt.ts";

type Status = "installed" | "missing" | "modified" | "unmanaged" | "unverified";
type Component = { path: string; status: Status };
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
  const linked = receipt?.files[dirname(path)];
  if (linked) {
    // A Claude skill installed as a symlink to the shared .agents copy.
    let target: string | null = null;
    try {
      target = readIntegrationLink(dirname(path));
    } catch {
      // A non-link entry at the directory is a modification.
    }
    return {
      path: dirname(path),
      status:
        target === null
          ? "missing"
          : hash(`symlink:${target}`) === linked.hash
            ? "installed"
            : "modified",
    };
  }
  const { text, readable } = read(path);
  const owned = receipt?.files[path];
  let status: Status;
  if (!readable || !reliable) status = "unverified";
  else if (text === null) status = "missing";
  else if (!owned?.owners.includes(agent)) status = "unmanaged";
  else if (hash(text) !== owned.hash || hash(expected) !== owned.hash)
    status = "modified";
  else status = "installed";
  return { path, status };
}

function inspectHook(
  path: string,
  agent: Agent,
  receipt: Receipt | undefined,
  reliable: boolean,
): { hook: Component; disableAllHooks?: boolean } {
  const { text, readable } = read(path);
  if (!readable || !reliable) return { hook: { path, status: "unverified" } };
  if (text === null) return { hook: { path, status: "missing" } };
  try {
    const settings: unknown = JSON.parse(text);
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new Error("Invalid settings");
    const value = settings as Record<string, unknown>;
    const hooks = value.hooks;
    if (
      hooks !== undefined &&
      (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    )
      throw new Error("Invalid hooks");
    const format = hookFormat(agent);
    const groups =
      (hooks as Record<string, unknown> | undefined)?.[format.event] ?? [];
    if (
      !Array.isArray(groups) ||
      groups.some((group) => format.commands(group) === null)
    )
      throw new Error("Invalid hook groups");
    const owned = receipt?.hooks[agent];
    const marked = groups.filter((group) => isMarked(format, group));
    const matches =
      owned?.path === path
        ? groups.filter((group) => isDeepStrictEqual(group, owned.group))
        : [];
    let status: Status;
    if (!owned || owned.path !== path)
      status = marked.length ? "unmanaged" : "missing";
    else if (
      matches.length === 1 &&
      marked.length === 1 &&
      format.commands(owned.group)?.includes(format.command)
    )
      status = "installed";
    else if (marked.length || matches.length) status = "modified";
    else status = "missing";
    return {
      hook: { path, status },
      ...(agent === "claude" && typeof value.disableAllHooks === "boolean"
        ? { disableAllHooks: value.disableAllHooks }
        : {}),
    };
  } catch {
    return { hook: { path, status: "unverified" } };
  }
}

export function inspectIntegrations(repository: string) {
  const results = [];
  for (const scope of ["project", "user"] as const) {
    const receipt = receiptAt(
      join(
        scope === "project" ? repository : homedir(),
        ".degreaser/integrations.json",
      ),
    );
    const reliable = receipt.state === "valid" || receipt.state === "missing";
    for (const harness of AGENTS) {
      const target = integrationTarget(harness, repository, scope);
      const files = [...target.files].map(([path, expected]) =>
        inspectFile(path, expected, harness, receipt.receipt, reliable),
      );
      const hookInfo = target.hookPath
        ? inspectHook(target.hookPath, harness, receipt.receipt, reliable)
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
