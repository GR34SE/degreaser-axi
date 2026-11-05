import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
