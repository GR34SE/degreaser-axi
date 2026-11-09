import { dirname, join, relative } from "node:path";
import { AGENTS, type Agent, HARNESSES } from "../modules/harness/api.ts";
import { InputError } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { hash } from "../util/hash.ts";
import { json } from "../util/json.ts";
import { HOOK_MARKER } from "./hook-command.ts";
import { updateHook } from "./hooks.ts";
import { type Receipt, validateReceipt } from "./receipt.ts";
import { planLinkedSkill, type SkillInstall } from "./skill/link.ts";
import { type InstallationScope, integrationTarget } from "./targets.ts";
import {
  conflict,
  IntegrationEdits,
  parseObject,
  readIntegrationLink,
} from "./transaction.ts";

export type { SkillInstall } from "./skill/link.ts";

export function prepareIntegrations(
  runtime: Runtime,
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
    !(
      harnesses.some((a) => HARNESSES[a].integration.skill === "native") &&
      harnesses.some((a) => HARNESSES[a].integration.skill === "shared")
    )
  )
    throw new InputError(
      "--skill-install link needs claude plus codex, pi or cursor: Claude's skill links to their .agents/skills copy.",
    );
  const edits = new IntegrationEdits();
  const base = scope === "project" ? repository : runtime.home;
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
  const sharedByOthers = (removing: Agent) =>
    AGENTS.some((other) => {
      if (other === removing || harnesses.includes(other)) return false;
      const { files: owned, hookPath } = integrationTarget(
        runtime,
        other,
        repository,
        scope,
      );
      if (HARNESSES[other].integration.skill === "native") {
        const dir = dirname([...owned.keys()][0] ?? "");
        return (
          readIntegrationLink(dir) === relative(dirname(dir), dirname(shared))
        );
      }
      return (
        (hookPath !== null &&
          (edits.read(hookPath) ?? "").includes(HOOK_MARKER)) ||
        [...owned.keys()].some((f) => f !== shared && edits.read(f) !== null)
      );
    });
  for (const agent of harnesses) {
    const target = integrationTarget(runtime, agent, repository, scope);
    let fileBelowRemovedLink = false;
    if (HARNESSES[agent].integration.skill === "native") {
      const skillFile = [...target.files.keys()].find((f) =>
        f.endsWith("/SKILL.md"),
      );
      if (skillFile) {
        const plan = planLinkedSkill(agent, edits, receipt, skillFile, shared, {
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
      const before = fileBelowRemovedLink ? null : edits.read(file);
      if (remove && !owned && before === content) {
        if (file !== shared || !sharedByOthers(agent)) edits.set(file, null);
        continue;
      }
      if (remove && !owned?.owners.includes(agent)) continue;
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
      updateHook(runtime, edits, receipt, agent, target.hookPath, remove);
    results.push({
      harness: agent,
      status: remove ? "removed" : "installed",
      activation: remove
        ? "Reload or restart the harness. Other scopes and foreign entries remain."
        : target.activation,
    });
  }
  const sharedOwner = receipt.files[shared];
  if (link && !remove && sharedOwner)
    sharedOwner.owners = [
      ...new Set([
        ...sharedOwner.owners,
        ...harnesses.filter(
          (agent) => HARNESSES[agent].integration.skill === "native",
        ),
      ]),
    ].sort();
  if (Object.keys(receipt.files).length || Object.keys(receipt.hooks).length)
    edits.set(path, json(receipt));
  else if (original !== null) edits.set(path, null);
  const roots = [
    repository,
    runtime.home,
    ...(scope === "user"
      ? AGENTS.map(
          (agent) =>
            integrationTarget(runtime, agent, repository, scope).directory,
        )
      : []),
  ];
  return { results, files, apply: () => edits.apply(roots) };
}
