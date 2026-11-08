import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertNativeVersion } from "../src/native-compatibility.ts";
import { callerProcess } from "./caller-process.ts";
import { stopCursorAt } from "./cursor-process.ts";

const { values } = parseArgs({
  options: { harnesses: { type: "string" }, help: { type: "boolean" } },
});
if (values.help) {
  console.log(
    "pnpm test:install --harnesses codex,claude,pi,cursor\nOpt-in native installation checks in disposable homes; no model inference. Select only installed harnesses. Claude and Pi accept the product's verified version or a newer same-major build and record the unverified notice. Cursor's file install is checked in the disposable home. Its project sessionStart hook is executed by the logged-in CLI on a pseudoterminal with --trust for that disposable repo only; the workspace record created for the repo is removed and user Cursor config is left unchanged. ACP session creation does not run sessionStart and is not treated as hook delivery.",
  );
  process.exit(0);
}
const harnesses = values.harnesses?.split(",") ?? [];
assert.ok(
  harnesses.length &&
    new Set(harnesses).size === harnesses.length &&
    harnesses.every((h) => ["codex", "claude", "pi", "cursor"].includes(h)),
  "Select --harnesses codex,claude,pi,cursor (one or more).",
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

function acceptedNative(agent: "claude" | "pi" | "cursor", output: string) {
  return assertNativeVersion(agent, output.trim().split(/\s+/)[0] ?? "");
}

function digestBytes(bytes: Buffer | null | undefined) {
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
}

function digest(path: string) {
  return existsSync(path) ? digestBytes(readFileSync(path)) : null;
}

function cursorProjects() {
  const dir = join(homedir(), ".cursor", "projects");
  return existsSync(dir) ? readdirSync(dir) : [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  // Startup context stays empty until a repository config exists.
  writeFileSync(
    join(cwd, ".degreaserrc.json"),
    `${JSON.stringify({ agent: "codex", model: "gpt-6-luna" })}\n`,
  );
  const userHarnesses = harnesses.filter((harness) => harness !== "cursor");
  if (userHarnesses.length)
    sync(process.execPath, [
      cli,
      "setup",
      "hooks",
      "--harnesses",
      userHarnesses.join(","),
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
    const accepted = acceptedNative("claude", sync("claude", ["--version"]));
    const found: Record<string, unknown> = {
      version: accepted.version,
      ...(accepted.notice ? { notice: accepted.notice } : {}),
    };
    evidence.claude = found;
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
    const accepted = acceptedNative("pi", sync("pi", ["--version"]));
    const found: Record<string, unknown> = {
      version: accepted.version,
      ...(accepted.notice ? { notice: accepted.notice } : {}),
    };
    evidence.pi = found;
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
  await check("cursor", async () => {
    const found: Record<string, unknown> = {};
    evidence.cursor = found;
    const accepted = acceptedNative(
      "cursor",
      sync("cursor-agent", ["--version"]),
    );
    found.version = accepted.version;
    if (accepted.notice) found.notice = accepted.notice;
    const userRepo = join(root, "cursor-user");
    mkdirSync(userRepo);
    sync("git", ["init", "-q", userRepo]);
    const userSetup = spawnSync(
      process.execPath,
      [
        cli,
        "setup",
        "hooks",
        "--harnesses",
        "cursor",
        "--installation-scope",
        "user",
      ],
      { cwd: userRepo, env, encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(userSetup.status, 0, userSetup.stdout + userSetup.stderr);
    const userHook = join(home, ".cursor", "hooks.json");
    const userSkill = join(home, ".agents", "skills", "degreaser", "SKILL.md");
    assert.equal(
      JSON.parse(readFileSync(userHook, "utf8")).hooks.sessionStart.length,
      1,
    );
    assert.match(readFileSync(userSkill, "utf8"), /^---\nname: degreaser\n/);
    found.disposableUserInstall = {
      hook: true,
      skill: true,
      cliDiscovery: false,
      reason:
        "A disposable HOME is logged out, so this proves the files Cursor loads, not that the logged-in CLI read them.",
    };
    const project = spawnSync(
      process.execPath,
      [
        cli,
        "setup",
        "hooks",
        "--harnesses",
        "cursor",
        "--installation-scope",
        "project",
      ],
      { cwd, env, encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(project.status, 0, project.stdout + project.stderr);
    const hookPath = join(cwd, ".cursor", "hooks.json");
    const settings = JSON.parse(readFileSync(hookPath, "utf8")) as {
      version: number;
      hooks: { sessionStart: { command: string }[] };
    };
    const installed = settings.hooks.sessionStart[0]?.command ?? "";
    assert.equal(settings.version, 1);
    assert.equal(settings.hooks.sessionStart.length, 1);
    assert.match(installed, /startup-context --cursor/);
    assert.match(
      readFileSync(
        join(cwd, ".agents", "skills", "degreaser", "SKILL.md"),
        "utf8",
      ),
      /^---\nname: degreaser\n/,
    );
    const direct = spawnSync("/bin/sh", ["-c", installed], {
      cwd,
      env: { ...env, DEGREASER_WORKER: "" },
      input: JSON.stringify({
        session_id: "install-check",
        is_background_agent: false,
        workspace_roots: [cwd],
      }),
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(direct.status, 0, direct.stderr);
    const payload = JSON.parse(direct.stdout) as {
      additional_context?: string;
    };
    assert.match(payload.additional_context ?? "", /codex\/gpt-6-luna/);
    assert.match(payload.additional_context ?? "", /No local run yet/);
    const sentinel = join(cwd, "cursor-session-start");
    const marker = join(cwd, ".cursor", "mark.sh");
    writeFileSync(
      marker,
      `#!/bin/sh\nprintf HOOK > '${sentinel.replaceAll("'", "'\\''")}'\n`,
    );
    settings.hooks.sessionStart.push({ command: `/bin/sh ${marker}` });
    writeFileSync(hookPath, `${JSON.stringify(settings, null, 2)}\n`);
    assert.equal(settings.hooks.sessionStart[0]?.command, installed);
    const userHooks = join(homedir(), ".cursor", "hooks.json");
    const userConfig = join(homedir(), ".cursor", "cli-config.json");
    const snapshots = [userHooks, userConfig].map((path) => ({
      path,
      bytes: existsSync(path) ? readFileSync(path) : null,
    }));
    const projectsBefore = new Set(cursorProjects());
    const cursorEnv = { ...process.env };
    delete cursorEnv.DEGREASER_WORKER;
    // script(1) closes stdin and the CLI exits before sessionStart. Hold a PTY open.
    const child = spawn(
      "python3",
      [
        "-c",
        `
import os, pty, sys
directory = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(directory)
    env = os.environ.copy()
    env.pop("DEGREASER_WORKER", None)
    os.execvpe("cursor-agent", ["cursor-agent", "--mode", "ask", "--sandbox", "enabled", "--trust"], env)
while True:
    try:
        os.read(fd, 4096)
    except OSError:
        break
`,
        cwd,
      ],
      { env: cursorEnv, detached: true, stdio: "ignore" },
    );
    let ran = false;
    try {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        if (existsSync(sentinel) && readFileSync(sentinel, "utf8") === "HOOK") {
          ran = true;
          break;
        }
        if (child.exitCode !== null) break;
        await sleep(200);
      }
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The PTY helper may already have left its process group.
        }
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // The helper already exited.
        }
      }
      stopCursorAt(cwd);
      await sleep(200);
      for (const snap of snapshots) {
        if (snap.bytes) writeFileSync(snap.path, snap.bytes);
        else if (existsSync(snap.path)) rmSync(snap.path);
      }
      const created = cursorProjects().filter(
        (name) => !projectsBefore.has(name),
      );
      const retained: string[] = [];
      for (const name of created) {
        if (
          name.includes("degreaser-native-install-") ||
          name.startsWith("private-var-folders-") ||
          name.startsWith("var-folders-")
        )
          rmSync(join(homedir(), ".cursor", "projects", name), {
            recursive: true,
            force: true,
          });
        else retained.push(name);
      }
      found.native = {
        sessionStartExecuted: ran,
        installedCommandPreserved: true,
        directAdditionalContext: true,
        trustRecordsRemoved: created.length - retained.length,
        unexpectedProjectRecords: retained,
        userHooksRestored:
          digest(userHooks) === digestBytes(snapshots[0]?.bytes),
        userConfigRestored:
          digest(userConfig) === digestBytes(snapshots[1]?.bytes),
      };
    }
    assert.equal(
      ran,
      true,
      "Cursor CLI did not execute the project sessionStart hook",
    );
    assert.deepEqual(
      (found.native as { unexpectedProjectRecords: string[] })
        .unexpectedProjectRecords,
      [],
    );
    assert.equal(
      (found.native as { userHooksRestored: boolean }).userHooksRestored,
      true,
    );
    assert.equal(
      (found.native as { userConfigRestored: boolean }).userConfigRestored,
      true,
    );
  });
} finally {
  console.log(JSON.stringify(evidence, null, 2));
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
