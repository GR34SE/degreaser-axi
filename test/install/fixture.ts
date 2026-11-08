import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNativeVersion } from "../../src/modules/harness/common/compatibility.ts";
import { callerProcess } from "../live/support/caller-process.ts";

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

export function installationFixture(harnesses: string[]) {
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
  const cli = fileURLToPath(new URL("../../dist/main.js", import.meta.url));
  const require = createRequire(import.meta.url);
  const adapter = createRequire(
    require.resolve("@agentclientprotocol/codex-acp/package.json"),
  );
  const manifestPath = adapter.resolve("@openai/codex/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const codex = join(dirname(manifestPath), manifest.bin.codex);
  const evidence: Record<string, unknown> = { harnesses, inference: false };

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

  return {
    root,
    home,
    cwd,
    env,
    cli,
    evidence,
    manifest,
    codex,
    sync,
    session,
    acceptedNative,
  };
}
export type InstallContext = ReturnType<typeof installationFixture>;
