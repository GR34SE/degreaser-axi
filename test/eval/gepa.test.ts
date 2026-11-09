import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("GEPA bridge enforces candidate, feedback and native reflection boundaries without inference", () => {
  const script = fileURLToPath(new URL("gepa-unit.py", import.meta.url));
  const result = spawnSync("python3", [script], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
