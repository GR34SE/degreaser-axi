import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("live pilots refuse unreadable settings before launching Pi", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-settings-read-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "settings.json"));
  for (const scenario of ["models", "native-worker"]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../scripts/test-live.ts", import.meta.url)),
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
  const script = fileURLToPath(
    new URL("../scripts/test-live.ts", import.meta.url),
  );
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
  const { assertClaudeModel } = await import("../scripts/live-profile.ts");
  assertClaudeModel("haiku", "claude-haiku-5-5");
  assertClaudeModel("haiku", "claude-haiku-4-5-20251001");
  assertClaudeModel("claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001");
  assert.throws(() => assertClaudeModel("haiku", "claude-sonnet-5-5"));
  assert.throws(() =>
    assertClaudeModel("claude-haiku-4-5-20251001", "claude-haiku-5-5"),
  );
  assert.throws(() => assertClaudeModel("haiku", undefined));
});
