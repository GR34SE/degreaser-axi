import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Agent } from "../modules/harness/api.ts";
import { AGENTS, HARNESSES, isAgent } from "../modules/harness/api.ts";
import { InputError } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { HOOK_MARKER, hookExecutable, hookSpec } from "./hook-command.ts";
import { renderSkill } from "./skill/guidance.ts";

export type InstallationScope = "project" | "user";
export function installationChoices(values: Record<string, unknown>): {
  harnesses: Agent[];
  scope: InstallationScope;
} {
  const harnesses = String(values.harnesses ?? "")
    .split(",")
    .map((v) => v.trim());
  if (!harnesses.every(isAgent) || new Set(harnesses).size !== harnesses.length)
    throw new InputError(
      `--harnesses requires a nonempty, duplicate-free selection of ${AGENTS.join(",")}.`,
    );
  const scope = values["installation-scope"] ?? "project";
  if (scope !== "project" && scope !== "user")
    throw new InputError("--installation-scope must be project or user.");
  return { harnesses, scope };
}

export function skillInstallChoice(
  values: Record<string, unknown>,
): "copy" | "link" {
  const choice = values["skill-install"] ?? "copy";
  if (choice !== "copy" && choice !== "link")
    throw new InputError("--skill-install must be copy or link.");
  return choice;
}

export interface HookFormat {
  event: string;
  command: string;
  version?: number;
  commands(group: unknown): unknown[] | null;
}
export function hookFormat(runtime: Runtime, agent: Agent): HookFormat {
  const hook = HARNESSES[agent].integration.hook;
  const command = hookSpec(runtime, hook.arguments).command;
  if (hook.kind === "flat")
    return {
      event: hook.event,
      command,
      ...(hook.version === undefined ? {} : { version: hook.version }),
      commands: (group) =>
        group &&
        typeof group === "object" &&
        typeof (group as { command?: unknown }).command === "string"
          ? [(group as { command: string }).command]
          : null,
    };
  return {
    event: hook.event,
    command,
    commands: (group) => {
      const hooks = (group as { hooks?: unknown } | null)?.hooks;
      return group && typeof group === "object" && Array.isArray(hooks)
        ? hooks.map((hook: { command?: unknown } | null) => hook?.command)
        : null;
    },
  };
}
export const isMarked = (format: HookFormat, group: unknown) =>
  (format.commands(group) ?? []).some(
    (command) => typeof command === "string" && command.includes(HOOK_MARKER),
  );

export function integrationTarget(
  runtime: Runtime,
  agent: Agent,
  repository: string,
  scope: InstallationScope,
) {
  const integration = HARNESSES[agent].integration;
  const base = scope === "project" ? repository : runtime.home;
  const configuredRoot =
    scope === "user" && integration.configRoot
      ? runtime.env[integration.configRoot]
      : undefined;
  if (configuredRoot && !isAbsolute(configuredRoot))
    throw new InputError(
      "Native user configuration roots must be absolute paths.",
    );
  const directory =
    configuredRoot ||
    join(
      base,
      scope === "user" ? integration.userDirectory : integration.directory,
    );
  const skill = join(
    integration.skill === "native" ? directory : join(base, ".agents"),
    "skills/degreaser/SKILL.md",
  );
  const files = new Map([[skill, renderSkill()]]);
  if (integration.extension) {
    const executable = hookExecutable(runtime);
    const extension = readFileSync(integration.extension, "utf8")
      .replace('"__DEGREASER_EXECUTABLE__"', JSON.stringify(executable[0]))
      .replace(
        '["__DEGREASER_ARGUMENTS__"]',
        JSON.stringify([...executable.slice(1), "startup-context", "--plain"]),
      );
    files.set(join(directory, "extensions/degreaser.ts"), extension);
  }
  return {
    directory,
    files,
    hookPath: integration.hook.filename
      ? join(directory, integration.hook.filename)
      : null,
    activation: integration.activation,
  };
}
