import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePortableHookCommand } from "axi-sdk-js";
import { AGENTS, type Agent, isAgent } from "./config.ts";
import { InputError } from "./input-error.ts";

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

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const bin = fileURLToPath(new URL("../bin/degreaser-axi.js", import.meta.url));
const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};
/** The bare command when PATH resolves to this install (AXI section 7), else absolute. */
const portable = resolvePortableHookCommand(
  bin,
  ["degreaser-axi", "degreaser"],
  "degreaser",
  {
    // Relative entries would resolve inside whatever repository runs the hook.
    pathEntries: (process.env.PATH ?? "").split(delimiter).filter(isAbsolute),
    pathExtensions: [""],
    resolveRealPath: realPath,
  },
);
const executable = portable === bin ? [process.execPath, bin] : [portable];
export const HOOK_MARKER = "degreaser-startup-v1";
const command = `if [ -z "\${DEGREASER_WORKER:-}" ]; then ${executable.map(quote).join(" ")} startup-context 2>/dev/null || :; fi # ${HOOK_MARKER}`;
export const hookSpec = { marker: HOOK_MARKER, command, timeoutSeconds: 2 };
const cursorCommand = `if [ -z "\${DEGREASER_WORKER:-}" ]; then ${executable.map(quote).join(" ")} startup-context --cursor 2>/dev/null || :; fi # ${HOOK_MARKER}`;

export interface HookFormat {
  event: string;
  /** The managed startup command for this harness. */
  command: string;
  version?: number;
  /** Commands in a hook group, or null when the group is malformed. */
  commands(group: unknown): unknown[] | null;
}
export function hookFormat(agent: Agent): HookFormat {
  if (agent === "cursor")
    return {
      event: "sessionStart",
      command: cursorCommand,
      version: 1,
      commands: (group) =>
        group &&
        typeof group === "object" &&
        typeof (group as { command?: unknown }).command === "string"
          ? [(group as { command: string }).command]
          : null,
    };
  return {
    event: "SessionStart",
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

function piExtension(): string {
  return `// Degreaser-owned startup integration. Repair with degreaser-axi setup hooks.
import { execFile } from "node:child_process";
export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.DEGREASER_WORKER) return;
    const context = await new Promise(resolve => {
      execFile(${JSON.stringify(executable[0])}, ${JSON.stringify([...executable.slice(1), "startup-context", "--plain"])},
        { cwd: ctx.cwd, timeout: 2000, maxBuffer: 4096 },
        (error, stdout) => resolve(error ? "" : stdout.trim()));
    });
    if (!context) return;
    if (ctx.sessionManager.getBranch().some(entry => entry.type === "custom_message" &&
      entry.customType === "degreaser-startup" && entry.content === context)) return;
    pi.sendMessage({ customType: "degreaser-startup", content: context, display: false },
      { triggerTurn: false });
  });
}
`;
}

export function integrationTarget(
  agent: Agent,
  repository: string,
  scope: InstallationScope,
) {
  const base = scope === "project" ? repository : homedir();
  const configuredRoot =
    scope === "user"
      ? {
          codex: process.env.CODEX_HOME,
          claude: process.env.CLAUDE_CONFIG_DIR,
          pi: process.env.PI_CODING_AGENT_DIR,
          cursor: undefined,
        }[agent]
      : undefined;
  if (configuredRoot && !isAbsolute(configuredRoot))
    throw new InputError(
      "Native user configuration roots must be absolute paths.",
    );
  const directory =
    configuredRoot ||
    join(base, agent === "pi" && scope === "user" ? ".pi/agent" : `.${agent}`);
  const skill = join(
    agent === "claude" ? directory : join(base, ".agents"),
    "skills/degreaser/SKILL.md",
  );
  const files = new Map([
    [
      skill,
      readFileSync(
        new URL("../assets/skills/degreaser/SKILL.md", import.meta.url),
        "utf8",
      ),
    ],
  ]);
  if (agent === "pi")
    files.set(join(directory, "extensions/degreaser.ts"), piExtension());
  return {
    files,
    hookPath:
      agent === "pi"
        ? null
        : join(directory, agent === "claude" ? "settings.json" : "hooks.json"),
    activation:
      agent === "codex"
        ? "Restart Codex; approve project and hook trust in the host. Hooks must be enabled by host policy (default on in 0.165.0). No trust, features or permissions were changed."
        : agent === "claude"
          ? "Start a new Claude session; project trust and host hook policy still apply. Installed files do not prove context delivery."
          : agent === "cursor"
            ? "Start a new Cursor agent chat; project trust still applies. Installed files do not prove context delivery."
            : "Reload Pi or start a new session; approve project resources through the host if required. Installed files do not prove context delivery.",
  };
}
