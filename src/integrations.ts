import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Ajv } from "ajv";
import type { HookGroup } from "axi-sdk-js";
import type { Agent } from "./config.ts";
import { repositoryRoot } from "./git.ts";
import { ensureStateIgnored } from "./init-ignore.ts";
import {
  conflict,
  IntegrationEdits,
  parseObject,
} from "./integration-files.ts";
import {
  HOOK_MARKER,
  type InstallationScope,
  installationChoices,
  integrationTarget,
  startupHook,
} from "./integration-targets.ts";
import { hash } from "./prompt.ts";
import { StateError } from "./storage.ts";

export interface Receipt {
  schemaVersion: 1;
  files: Record<string, { hash: string; owners: Agent[] }>;
  hooks: Partial<
    Record<
      Agent,
      { path: string; group: HookGroup; created: boolean; others: string[] }
    >
  >;
}
export const validateReceipt = new Ajv({ strict: true }).compile<Receipt>({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "files", "hooks"],
  properties: {
    schemaVersion: { const: 1 },
    files: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["hash", "owners"],
        properties: {
          hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          owners: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { enum: ["codex", "claude", "pi"] },
          },
        },
      },
    },
    hooks: {
      type: "object",
      propertyNames: { enum: ["codex", "claude"] },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["path", "group", "created", "others"],
        properties: {
          path: { type: "string" },
          group: { type: "object" },
          created: { type: "boolean" },
          others: {
            type: "array",
            items: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
        },
      },
    },
  },
});
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function updateHook(
  edits: IntegrationEdits,
  receipt: Receipt,
  agent: Agent,
  path: string,
  remove: boolean,
) {
  const text = edits.read(path);
  const settings = parseObject(text ?? "{}", path);
  const hooks = settings.hooks === undefined ? {} : settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    conflict(path);
  const events = hooks as Record<string, unknown>;
  const groups = events.SessionStart ?? [];
  if (
    !Array.isArray(groups) ||
    groups.some(
      (group) =>
        !group || typeof group !== "object" || !Array.isArray(group.hooks),
    )
  )
    conflict(path);
  const previous = receipt.hooks[agent];
  if (previous && previous.path !== path) conflict(path);
  const matches = groups.filter(
    (group) => previous && isDeepStrictEqual(group, previous.group),
  );
  const marked = groups.filter((group) =>
    group.hooks.some(
      (hook: { command?: unknown }) =>
        typeof hook?.command === "string" && hook.command.includes(HOOK_MARKER),
    ),
  );
  if (matches.length > 1 || marked.some((group) => !matches.includes(group)))
    conflict(path);
  const remaining = groups.filter((group) => !matches.includes(group));
  const others = remaining.map((group) => hash(JSON.stringify(group)));
  if (
    previous &&
    !matches.length &&
    others.some((digest) => !previous.others.includes(digest))
  )
    conflict(path);
  if (remove) {
    if (!previous) return;
    delete receipt.hooks[agent];
    if (!matches.length) return;
    if (remaining.length) events.SessionStart = remaining;
    else delete events.SessionStart;
    if (Object.keys(events).length) settings.hooks = events;
    else delete settings.hooks;
    edits.set(
      path,
      previous.created && Object.keys(settings).length === 0
        ? null
        : json(settings),
    );
    return;
  }
  receipt.hooks[agent] = {
    path,
    group: startupHook,
    created: previous?.created ?? text === null,
    others,
  };
  if (matches.length === 1 && isDeepStrictEqual(previous?.group, startupHook))
    return;
  events.SessionStart = [...remaining, startupHook];
  settings.hooks = events;
  edits.set(path, json(settings));
}

export function prepareIntegrations(
  repository: string,
  harnesses: Agent[],
  scope: InstallationScope,
  remove = false,
) {
  const edits = new IntegrationEdits();
  const path = join(
    scope === "project" ? repository : homedir(),
    ".degreaser/integrations.json",
  );
  const original = edits.read(path);
  const receipt: Receipt =
    original === null
      ? { schemaVersion: 1, files: {}, hooks: {} }
      : (() => {
          const value = parseObject(original, path);
          if (!validateReceipt(value)) conflict(path);
          return value;
        })();
  const results = [];
  const files: string[] = [];
  for (const agent of harnesses) {
    const target = integrationTarget(agent, repository, scope);
    files.push(
      ...target.files.keys(),
      ...(target.hookPath ? [target.hookPath] : []),
    );
    for (const [file, content] of target.files) {
      const owned = receipt.files[file];
      if (remove && !owned?.owners.includes(agent)) continue;
      const before = edits.read(file);
      if (before !== null && (!owned || hash(before) !== owned.hash))
        conflict(file);
      if (remove) {
        if (!owned?.owners.includes(agent)) continue;
        owned.owners = owned.owners.filter((owner) => owner !== agent);
        if (!owned.owners.length) {
          delete receipt.files[file];
          edits.set(file, null);
        }
      } else {
        receipt.files[file] = {
          hash: hash(content),
          owners: [...new Set([...(owned?.owners ?? []), agent])].sort(),
        };
        edits.set(file, content);
      }
    }
    if (target.hookPath)
      updateHook(edits, receipt, agent, target.hookPath, remove);
    results.push({
      harness: agent,
      status: remove ? "removed" : "installed",
      activation: remove
        ? "Reload or restart the harness. Other scopes and foreign entries remain."
        : target.activation,
    });
  }
  if (Object.keys(receipt.files).length || Object.keys(receipt.hooks).length)
    edits.set(path, json(receipt));
  else if (original !== null) edits.set(path, null);
  return { results, files, apply: () => edits.apply() };
}

export function setupIntegrations(
  values: Record<string, unknown>,
  cwd: string,
) {
  if (process.env.DEGREASER_WORKER)
    throw new StateError(
      "nested-review",
      "Workers cannot install Degreaser integrations.",
    );
  const { harnesses, scope } = installationChoices(values);
  const repository = repositoryRoot(cwd);
  const plan = prepareIntegrations(
    repository,
    harnesses,
    scope,
    values.remove === true,
  );
  if (scope === "project" && !values.remove) ensureStateIgnored(repository);
  plan.apply();
  return {
    status: values.remove ? "removed" : "installed",
    installationScope: scope,
    integrations: plan.results,
  };
}
