import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reserveSessions } from "../../eval/admissions.mjs";

test("admission reserves retries and retains the cap across resumed executions", () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-admissions-"));
  const path = join(directory, "admissions.json");
  try {
    assert.equal(reserveSessions(path, 6, 2), 4);
    assert.equal(reserveSessions(path, 6, 1), 6);
    const receipt = readFileSync(path, "utf8");
    assert.throws(() => reserveSessions(path, 6, 1), /exhausted/);
    assert.throws(() => reserveSessions(path, 8, 1), /changed budget/);
    assert.equal(readFileSync(path, "utf8"), receipt);
    writeFileSync(`${path}.lock`, "");
    assert.throws(() => reserveSessions(path, 6, 1), /EEXIST/);
    assert.equal(readFileSync(path, "utf8"), receipt);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
