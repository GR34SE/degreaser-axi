import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Ajv } from "ajv";
import {
  computeSessionStartHookRemoval,
  computeSessionStartHookUpdate,
  type HookGroup,
} from "axi-sdk-js";
import type { Agent } from "./config.ts";
import { repositoryRoot } from "./git.ts";
import { ensureStateIgnored } from "./init-ignore.ts";
import { InputError } from "./input-error.ts";
import {
  conflict,
  IntegrationEdits,
  parseObject,
  readIntegrationLink,
} from "./integration-files.ts";
import {
  HOOK_MARKER,
  hookSpec,
  type InstallationScope,
  installationChoices,
  integrationTarget,
  skillInstallChoice,
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
  const marked = groups.filter((group) =>
    group.hooks.some(
      (hook: { command?: unknown }) =>
        typeof hook?.command === "string" && hook.command.includes(HOOK_MARKER),
    ),
  );
  // Without a receipt (fresh clone, new worktree), our marked entry is ours.
  const matches = previous
    ? groups.filter((group) => isDeepStrictEqual(group, previous.group))
    : !remove && marked.length === 1
      ? marked
      : [];
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
    const [cleaned] = computeSessionStartHookRemoval(settings, HOOK_MARKER);
    edits.set(
      path,
      previous.created && Object.keys(cleaned).length === 0
        ? null
        : json(cleaned),
    );
    return;
  }
  const [updated, changed] = computeSessionStartHookUpdate(settings, hookSpec);
  const group = updated.hooks?.SessionStart?.find((g) =>
    g.hooks?.some((hook) => hook.command?.includes(HOOK_MARKER)),
  );
  receipt.hooks[agent] = {
    path,
    group: group ?? {},
    created: previous?.created ?? text === null,
    others,
  };
  if (changed) edits.set(path, json(updated));
}

export type SkillInstall = "copy" | "link";

/** Claude's skill directory as a link to the shared .agents copy, or back to a copy. */
function planClaudeSkill(
  edits: IntegrationEdits,
  receipt: Receipt,
  skillFile: string,
  shared: string,
  options: {
    link: boolean;
    remove: boolean;
    replace: ReadonlySet<string>;
    content: string;
  },
): { skipFile: boolean; fileBelowRemovedLink: boolean } {
  const dir = dirname(skillFile);
  const current = readIntegrationLink(dir);
  const isLink = current !== null && current !== "";
  const ownedLink =
    isLink &&
    receipt.files[dir]?.hash === hash(`symlink:${current}`) &&
    receipt.files[dir]?.owners.includes("claude");
  if (options.remove || !options.link) {
    // Claude no longer reads the shared copy through a link.
    const sharedOwner = receipt.files[shared];
    if (sharedOwner?.owners.includes("claude")) {
      sharedOwner.owners = sharedOwner.owners.filter((o) => o !== "claude");
      if (!sharedOwner.owners.length) {
        delete receipt.files[shared];
        edits.set(shared, null);
      }
    }
    if (!isLink) return { skipFile: false, fileBelowRemovedLink: false };
    if (!ownedLink && !options.replace.has(dir)) conflict(dir, !options.remove);
    edits.link(dir, null);
    delete receipt.files[dir];
    return { skipFile: options.remove, fileBelowRemovedLink: true };
  }
  const target = relative(dirname(dir), dirname(shared));
  if (current !== target) {
    if (isLink && !ownedLink && !options.replace.has(dir)) conflict(dir, true);
    if (current === "") {
      if (readdirSync(dir).some((entry) => entry !== "SKILL.md")) conflict(dir);
      const before = edits.read(skillFile);
      const owned = receipt.files[skillFile];
      if (
        before !== null &&
        owned?.hash !== hash(before) &&
        before !== options.content &&
        !options.replace.has(skillFile)
      )
        conflict(skillFile, true);
      if (before !== null) edits.set(skillFile, null);
      if (owned) {
        owned.owners = owned.owners.filter((o) => o !== "claude");
        if (!owned.owners.length) delete receipt.files[skillFile];
      }
    }
    edits.link(dir, target);
  }
  receipt.files[dir] = { hash: hash(`symlink:${target}`), owners: ["claude"] };
  return { skipFile: true, fileBelowRemovedLink: false };
}

export function prepareIntegrations(
  repository: string,
  harnesses: Agent[],
  scope: InstallationScope,
  options: {
    remove?: boolean;
    replace?: ReadonlySet<string>;
    skillInstall?: SkillInstall;
  } = {},
) {
  const { remove = false, replace = new Set<string>() } = options;
  const link = options.skillInstall === "link";
  if (
    link &&
    !remove &&
    !(harnesses.includes("claude") && harnesses.some((a) => a !== "claude"))
  )
    throw new InputError(
      "--skill-install link needs claude plus codex or pi: Claude's skill links to their .agents/skills copy.",
    );
  const edits = new IntegrationEdits();
  const base = scope === "project" ? repository : homedir();
  const path = join(base, ".degreaser/integrations.json");
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
  const shared = join(base, ".agents/skills/degreaser/SKILL.md");
  for (const agent of harnesses) {
    const target = integrationTarget(agent, repository, scope);
    let fileBelowRemovedLink = false;
    if (agent === "claude") {
      const skillFile = [...target.files.keys()].find((f) =>
        f.endsWith("/SKILL.md"),
      );
      if (skillFile) {
        const plan = planClaudeSkill(edits, receipt, skillFile, shared, {
          link,
          remove,
          replace,
          content: target.files.get(skillFile) ?? "",
        });
        fileBelowRemovedLink = plan.fileBelowRemovedLink;
        if (plan.skipFile) {
          target.files.delete(skillFile);
          if (!remove) files.push(dirname(skillFile));
        }
      }
    }
    files.push(
      ...target.files.keys(),
      ...(target.hookPath ? [target.hookPath] : []),
    );
    for (const [file, content] of target.files) {
      const owned = receipt.files[file];
      if (remove && !owned?.owners.includes(agent)) continue;
      const before = fileBelowRemovedLink ? null : edits.read(file);
      const adoptable = !remove && (before === content || replace.has(file));
      if (
        before !== null &&
        (!owned || hash(before) !== owned.hash) &&
        !adoptable
      )
        conflict(file, !remove);
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
        if (fileBelowRemovedLink) edits.set(file, content, { before: null });
        else edits.set(file, content);
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
  // A linked Claude skill keeps the shared copy alive until Claude is removed.
  const sharedOwner = receipt.files[shared];
  if (link && !remove && sharedOwner && !sharedOwner.owners.includes("claude"))
    sharedOwner.owners = [...sharedOwner.owners, "claude" as const].sort();
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
  const plan = prepareIntegrations(repository, harnesses, scope, {
    remove: values.remove === true,
    skillInstall: skillInstallChoice(values),
  });
  if (scope === "project" && !values.remove) ensureStateIgnored(repository);
  plan.apply();
  return {
    status: values.remove ? "removed" : "installed",
    installationScope: scope,
    integrations: plan.results,
  };
}
