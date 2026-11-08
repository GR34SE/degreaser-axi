import { claudeCaller } from "./caller-native/claude.ts";
import { codexCaller } from "./caller-native/codex.ts";
import { cursorCaller } from "./caller-native/cursor.ts";
import { piCaller } from "./caller-native/pi.ts";

const CALLERS = {
  pi: piCaller,
  claude: claudeCaller,
  cursor: cursorCaller,
  codex: codexCaller,
};

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Agent } from "../../../src/config/types.ts";
import { assertNativeVersion } from "../../../src/modules/harness/common/compatibility.ts";
import type { CallerEvidence } from "./caller-evidence.ts";
import { callerEnvironment } from "./caller-process.ts";

export async function nativeCaller(
  agent: Agent,
  model: string,
  cwd: string,
  prompt: string,
  trace: CallerEvidence,
  checkFiles: () => void,
  phase: "context" | "review",
  extraEnvironment: Record<string, string> = {},
) {
  const launcher = fileURLToPath(
    new URL("../../../dist/modules/harness/codex/launcher.js", import.meta.url),
  );
  const executable = agent === "cursor" ? "cursor-agent" : agent;
  const version = spawnSync(
    agent === "codex" ? process.execPath : executable,
    agent === "codex" ? [launcher, "--version"] : ["--version"],
    { cwd, env: callerEnvironment, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(
    version.status,
    0,
    version.stderr || "Native version probe failed",
  );
  const rawVersion = version.stdout.trim();
  const nativeVersion =
    agent === "cursor"
      ? (rawVersion.split(/\s+/)[0] ?? "")
      : (rawVersion.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? "");
  if (agent === "codex")
    assert.equal(
      nativeVersion,
      "0.165.0",
      "Revalidate changed bundled Codex before inference",
    );
  else {
    const accepted = assertNativeVersion(agent, nativeVersion);
    if (accepted.notice)
      console.log(JSON.stringify({ agent, notice: accepted.notice }));
  }
  const observe = (event: Record<string, unknown>) => {
    trace.record(event);
    checkFiles();
  };
  return CALLERS[agent]({
    model,
    cwd,
    prompt,
    trace,
    observe,
    phase,
    extraEnvironment,
    executable,
    launcher,
    nativeVersion,
  });
}
