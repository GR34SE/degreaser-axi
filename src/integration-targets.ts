import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSessionStartHookUpdate, type HookGroup } from "axi-sdk-js";
import type { Agent } from "./config.ts";
import { InputError } from "./input-error.ts";

export type InstallationScope = "project" | "user";
export function installationChoices(values: Record<string, unknown>): {
  harnesses: Agent[];
  scope: InstallationScope;
} {
  const harnesses = String(values.harnesses ?? "")
    .split(",")
    .map((v) => v.trim());
  if (
    !harnesses.every((v): v is Agent =>
      ["codex", "claude", "pi"].includes(v),
    ) ||
    new Set(harnesses).size !== harnesses.length
  )
    throw new InputError(
      "--harnesses requires a nonempty, duplicate-free selection of codex,claude,pi.",
    );
  const scope = values["installation-scope"] ?? "project";
  if (scope !== "project" && scope !== "user")
    throw new InputError("--installation-scope must be project or user.");
  return { harnesses, scope };
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const startup = fileURLToPath(
  new URL("../bin/startup-context.js", import.meta.url),
);
export const HOOK_MARKER = "degreaser-startup-v1";
const command = `if [ -z "\${DEGREASER_WORKER:-}" ]; then ${quote(process.execPath)} ${quote(startup)} 2>/dev/null || :; fi # ${HOOK_MARKER}`;
const [settings] = computeSessionStartHookUpdate(
  {},
  { marker: HOOK_MARKER, command, timeoutSeconds: 2 },
);
export const startupHook: HookGroup = settings.hooks?.SessionStart?.[0] ?? {};

function piExtension(): string {
  return `// Degreaser-owned startup integration. Repair with degreaser-axi setup hooks.
import { execFile } from "node:child_process";
export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.DEGREASER_WORKER) return;
    const context = await new Promise(resolve => {
      execFile(${JSON.stringify(process.execPath)}, [${JSON.stringify(startup)}, "--plain"],
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
        : join(directory, agent === "codex" ? "hooks.json" : "settings.json"),
    activation:
      agent === "codex"
        ? "Restart Codex; approve project and hook trust in the host. Hooks must be enabled by host policy (default on in 0.165.0). No trust, features or permissions were changed."
        : agent === "claude"
          ? "Start a new Claude session; project trust and host hook policy still apply. Installed files do not prove context delivery."
          : "Reload Pi or start a new session; approve project resources through the host if required. Installed files do not prove context delivery.",
  };
}
