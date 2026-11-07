import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { callerProcess } from "./caller-process.ts";

const { values } = parseArgs({
  options: { harnesses: { type: "string" }, help: { type: "boolean" } },
});
if (values.help) {
  console.log(
    "pnpm test:install --harnesses codex,claude,pi\nOpt-in native installation metadata checks in disposable homes; no model inference. Select only installed harnesses. Cursor is not implemented here; use its live init/review checks.",
  );
  process.exit(0);
}
const harnesses = values.harnesses?.split(",") ?? [];
assert.ok(
  harnesses.length &&
    new Set(harnesses).size === harnesses.length &&
    harnesses.every((h) => ["codex", "claude", "pi"].includes(h)),
  "Select --harnesses codex,claude,pi (one or more; Cursor installation metadata check is not implemented).",
);

// Opt-in native discovery only: no model prompts, real credentials, or trust changes.
const root = realpathSync(
  mkdtempSync(join(realpathSync(tmpdir()), "degreaser-native-install-")),
);
const home = join(root, "home");
const cwd = join(root, "repo");
mkdirSync(home);
mkdirSync(cwd);
const env: NodeJS.ProcessEnv = {
  HOME: home,
  CODEX_HOME: join(home, ".codex"),
  CLAUDE_CONFIG_DIR: join(home, ".claude"),
  PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
  PATH: process.env.PATH,
  TMPDIR: root,
  LANG: "en_US.UTF-8",
  GIT_CONFIG_NOSYSTEM: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
};
const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const require = createRequire(import.meta.url);
const adapter = createRequire(
  require.resolve("@agentclientprotocol/codex-acp/package.json"),
);
const manifestPath = adapter.resolve("@openai/codex/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const codex = join(dirname(manifestPath), manifest.bin.codex);
const evidence: Record<string, unknown> = { harnesses, inference: false };
let failed = false;

interface NativeItem {
  name?: string;
  description?: string;
  command?: string;
  source?: string;
  sourcePath?: string;
  enabled?: boolean;
  trustStatus?: string;
  scope?: string;
  path?: string;
  sourceInfo?: { scope?: string; path?: string };
  customType?: string;
  content?: string;
  display?: boolean;
}
interface NativeEvent {
  id?: string | number;
  type?: string;
  error?: unknown;
  response?: NativeEvent & { request_id?: string; commands?: NativeItem[] };
  result?: { data?: { hooks?: NativeItem[]; skills?: NativeItem[] }[] };
  data?: { commands?: NativeItem[]; messages?: NativeItem[] };
}

function sync(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed: ${result.error?.message ?? `exit ${result.status}`}`,
  );
  return result.stdout.trim();
}

async function session(
  command: string,
  args: string[],
  action: (
    request: (
      value: object,
      match: (event: NativeEvent) => boolean,
    ) => Promise<NativeEvent>,
  ) => Promise<void>,
) {
  const host = callerProcess(command, args, cwd, () => {}, env);
  try {
    await action((value, match) => host.request(value, match));
  } finally {
    await host.close();
  }
}

async function check(name: string, run: () => Promise<void>) {
  if (!harnesses.includes(name)) return;
  try {
    await run();
  } catch (error) {
    failed = true;
    evidence[name] = {
      ...(typeof evidence[name] === "object" ? evidence[name] : {}),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

try {
  sync("git", ["init", "-q"]);
  sync(process.execPath, [
    cli,
    "setup",
    "hooks",
    "--harnesses",
    harnesses.join(","),
    "--installation-scope",
    "user",
  ]);
  await check("codex", async () => {
    assert.equal(manifest.version, "0.165.0");
    const found: Record<string, unknown> = { version: manifest.version };
    evidence.codex = found;
    await session(process.execPath, [codex, "app-server"], async (request) => {
      const init = await request(
        {
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "native_install_check", version: "1" },
            capabilities: { experimentalApi: true },
          },
        },
        (e) => e.id === 1,
      );
      assert.ok(init.result, JSON.stringify(init.error));
      const hooks = await request(
        { id: 2, method: "hooks/list", params: { cwds: [cwd] } },
        (e) => e.id === 2,
      );
      const skills = await request(
        {
          id: 3,
          method: "skills/list",
          params: { cwds: [cwd], forceReload: true },
        },
        (e) => e.id === 3,
      );
      const hook = hooks.result?.data
        ?.flatMap((d) => d.hooks ?? [])
        .find((h) => h.command?.includes("degreaser-startup-v1"));
      const skill = skills.result?.data
        ?.flatMap((d) => d.skills ?? [])
        .find((s) => s.name === "degreaser");
      found.hook = hook && {
        source: hook.source,
        sourceMatches: hook.sourcePath === join(home, ".codex/hooks.json"),
        enabled: hook.enabled,
        trustStatus: hook.trustStatus,
      };
      found.skill = skill && {
        scope: skill.scope,
        enabled: skill.enabled,
        pathMatches:
          skill.path === join(home, ".agents/skills/degreaser/SKILL.md"),
      };
      assert.ok(
        hook &&
          hook.source === "user" &&
          hook.sourcePath === join(home, ".codex/hooks.json") &&
          hook.enabled,
        "owned user hook not recognized",
      );
      assert.ok(
        skill &&
          skill.scope === "user" &&
          skill.enabled &&
          skill.path === join(home, ".agents/skills/degreaser/SKILL.md"),
        "user skill not recognized",
      );
    });
  });
  await check("claude", async () => {
    const version = sync("claude", ["--version"]);
    const found: Record<string, unknown> = { version };
    evidence.claude = found;
    assert.match(version, /^2\.1\.317\b/);
    const debug = join(root, "claude-debug.log");
    await session(
      "claude",
      [
        "--print",
        "--verbose",
        "--debug-file",
        debug,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--setting-sources",
        "user",
        "--strict-mcp-config",
      ],
      async (request) => {
        const init = await request(
          {
            type: "control_request",
            request_id: "init",
            request: { subtype: "initialize" },
          },
          (e) =>
            e.type === "control_response" && e.response?.request_id === "init",
        );
        const skill = init.response?.response?.commands?.find(
          (c) => c.name === "degreaser",
        );
        found.skill = skill && {
          name: skill.name,
          user: skill.description?.endsWith("(user)"),
        };
        assert.ok(
          skill?.description?.endsWith("(user)"),
          "user skill not recognized",
        );
      },
    );
    const debugLines = readFileSync(debug, "utf8").split("\n");
    const finished = debugLines.some(
      (line) =>
        line.includes("SessionStart:startup") &&
        line.includes("degreaser-startup-v1") &&
        line.includes("finished with status 0"),
    );
    const context = debugLines.some(
      (line) =>
        line.includes("degreaser-startup-v1") &&
        line.includes("provided additionalContext"),
    );
    const parsed = debugLines.some((line) =>
      line.includes("Successfully parsed and validated hook JSON output"),
    );
    found.startup = {
      ownedHookSucceeded: finished,
      additionalContextProvided: context,
      jsonValidated: parsed,
    };
    assert.ok(
      finished && context && parsed,
      "owned startup hook did not deliver validated additional context",
    );
  });
  await check("pi", async () => {
    const expectedContext = sync(process.execPath, [
      cli,
      "startup-context",
      "--plain",
    ]);
    assert.ok(expectedContext);
    const version = sync("pi", ["--version"]);
    const found: Record<string, unknown> = { version };
    evidence.pi = found;
    assert.equal(version, "1.4.0");
    await session(
      "pi",
      ["--mode", "rpc", "--offline", "--no-session"],
      async (request) => {
        const commands = await request(
          { id: "commands", type: "get_commands" },
          (e) => e.id === "commands",
        );
        const messages = await request(
          { id: "messages", type: "get_messages" },
          (e) => e.id === "messages",
        );
        const skill = commands.data?.commands?.find(
          (c) => c.name === "skill:degreaser",
        );
        const message = messages.data?.messages?.find(
          (m) => m.customType === "degreaser-startup",
        );
        found.skill = skill && {
          source: skill.source,
          scope: skill.sourceInfo?.scope,
          pathMatches:
            skill.sourceInfo?.path ===
            join(home, ".agents/skills/degreaser/SKILL.md"),
        };
        found.startup = message && {
          delivered: message.content === expectedContext,
          display: message.display,
        };
        assert.ok(
          skill?.source === "skill" &&
            skill.sourceInfo?.scope === "user" &&
            skill.sourceInfo?.path ===
              join(home, ".agents/skills/degreaser/SKILL.md"),
          "user skill not recognized",
        );
        assert.ok(
          message?.content === expectedContext,
          "startup context not delivered",
        );
      },
    );
  });
} finally {
  console.log(JSON.stringify(evidence, null, 2));
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
