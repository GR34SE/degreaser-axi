import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("compiled CLI completes deterministic init, review and same-run resume", () => {
  const scenario = fileURLToPath(
    new URL("../scripts/qa/scenario.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [scenario], {
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /no model inference/);
});
