import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stopCursorAt } from "./support/cursor-process.ts";

for (const code of ["ESRCH", "EPERM"]) {
  test(`Cursor cleanup tolerates only an exited process: ${code}`, async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "degreaser-cursor-cleanup-"));
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.title = "cursor-agent"; console.log("ready"); setInterval(() => {}, 1000);',
      ],
      { cwd, stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = once(child, "exit");
    const kill = process.kill.bind(process);
    t.after(async () => {
      if (child.pid && child.exitCode === null && child.signalCode === null)
        kill(child.pid, "SIGKILL");
      await exited;
      rmSync(cwd, { recursive: true, force: true });
    });
    await once(child.stdout, "data");
    let attempts = 0;
    const failure = Object.assign(new Error("Synthetic kill failure"), {
      code,
    });
    t.mock.method(
      process,
      "kill",
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (pid !== child.pid) return kill(pid, signal);
        attempts += 1;
        throw failure;
      },
    );
    if (code === "ESRCH") assert.doesNotThrow(() => stopCursorAt(cwd));
    else
      assert.throws(
        () => stopCursorAt(cwd),
        (error) => error === failure,
      );
    assert.equal(attempts, 1);
  });
}

test("live pilots refuse unreadable settings before launching Pi", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-settings-read-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "settings.json"));
  for (const scenario of ["models", "native-worker"]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./run.ts", import.meta.url)),
        "--run",
        "--case",
        scenario,
        "--agent",
        "pi",
        "--model",
        "synthetic/model",
      ],
      {
        env: { PATH: "", PI_CODING_AGENT_DIR: root },
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EISDIR/);
    assert.equal(result.stdout, "");
  }
});

test("live scaffold never reports unimplemented scenarios as passing", () => {
  const script = fileURLToPath(new URL("./run.ts", import.meta.url));
  for (const args of [[], ["--run"]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { PATH: "" },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Nothing ran; no live assertions passed/);
  }
  const help = spawnSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /opt-in/i);
});

test("native Claude evidence distinguishes a selected alias from its resolved model", async () => {
  const { assertClaudeModel } = await import("./support/live-profile.ts");
  assertClaudeModel("haiku", "claude-haiku-5-5");
  assertClaudeModel("haiku", "claude-haiku-4-5-20251001");
  assertClaudeModel("claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001");
  assert.throws(() => assertClaudeModel("haiku", "claude-sonnet-5-5"));
  assert.throws(() =>
    assertClaudeModel("claude-haiku-4-5-20251001", "claude-haiku-5-5"),
  );
  assert.throws(() => assertClaudeModel("haiku", undefined));
});

test("Cursor version-only evidence does not claim ask mode or ACP verification", async (t) => {
  const { inspectNativeProfile } = await import("./support/live-profile.ts");
  const cwd = mkdtempSync(join(tmpdir(), "degreaser-cursor-version-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const executable = join(cwd, "version-only");
  const observedVersion = "2026.11.05-86047df";
  writeFileSync(
    executable,
    `#!${process.execPath}
if (process.argv.length !== 3 || process.argv[2] !== "--version") process.exit(64);
console.log("diagnostic prefix", ${JSON.stringify(observedVersion)}, "diagnostic suffix");
`,
    { mode: 0o755 },
  );
  const evidence = inspectNativeProfile(
    {
      agent: "cursor",
      model: "synthetic/model",
      command: [],
      environment: { DEGREASER_NATIVE_EXECUTABLE: executable },
      adapterVersion: "native-acp",
      nativeVersion: "unobserved",
      limitations: [],
    },
    cwd,
    "unused-nonce",
    "unused-marker",
  );
  assert.equal("askModeArgv" in evidence, false);
  assert.equal("nativeAcp" in evidence, false);
  assert.ok("nativeVersion" in evidence);
  assert.equal(evidence.nativeVersion, observedVersion);
  assert.match(evidence.residual ?? "", /ask mode.*ACP.*not verified/);
});
