import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../src/config.ts";
import { fixture } from "./git-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const allAspects = [
  "missed-reuse",
  "unnecessary-layers",
  "speculative-flexibility",
  "masked-errors",
  "unjustified-defense",
  "low-value-comments",
  "convention-drift",
  "scope-creep",
  "contract-bypass",
  "low-value-tests",
  "incomplete-integration",
  "wrong-abstraction",
  "reinvented-infrastructure",
  "unidiomatic-code",
  "structural-erosion",
  "verification-theater",
];
const full = {
  schemaVersion: 1,
  agent: "codex",
  model: "gpt-6-luna",
  concurrency: null,
  maxRetries: 1,
  limits: {
    workerTimeoutSeconds: 300,
    workerIdleSeconds: 120,
    maxTurns: 40,
    runTimeoutSeconds: 900,
  },
  aspects: Object.fromEntries(allAspects.map((id) => [id, true])),
  exclude: [],
};
function run(root: string, args = ["config", "sync"], worker = false) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, DEGREASER_WORKER: worker ? "1" : "" },
  });
}

test("config sync expands a legacy RC, preserves effective behavior and is a byte-stable no-op when complete", (t) => {
  const f = fixture(t);
  const path = join(f.root, ".degreaserrc.json");
  const before = resolveConfig(JSON.parse(readFileSync(path, "utf8")));
  const index = readFileSync(join(f.root, ".git/index"));
  const result = run(f.root);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /status: synchronized/);
  assert.match(result.stdout, /limits.maxTurns/);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), full);
  assert.deepEqual(resolveConfig(full), before);
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(existsSync(join(f.root, ".degreaser")), false);
  assert.equal(existsSync(join(f.root, ".agents")), false);
  assert.equal(existsSync(join(f.root, ".claude")), false);
  const text = readFileSync(path, "utf8");
  const mtime = statSync(path).mtimeMs;
  assert.match(run(f.root).stdout, /status: unchanged/);
  assert.equal(readFileSync(path, "utf8"), text);
  assert.equal(statSync(path).mtimeMs, mtime);
});

test("sync fills only absent nested settings, retaining explicit aspect settings, overrides and zero retries", (t) => {
  const f = fixture(t);
  const previous = {
    agent: "claude",
    model: "chosen-model",
    concurrency: 3,
    maxRetries: 0,
    limits: { maxTurns: 12 },
    aspects: {
      "low-value-comments": false,
      "missed-reuse": { model: "another-model" },
    },
    exclude: ["vendor"],
  };
  f.write(".degreaserrc.json", JSON.stringify(previous));
  const before = resolveConfig(previous);
  assert.equal(run(f.root).status, 0);
  const saved = JSON.parse(
    readFileSync(join(f.root, ".degreaserrc.json"), "utf8"),
  );
  assert.deepEqual(saved, {
    ...full,
    ...previous,
    limits: {
      workerTimeoutSeconds: 300,
      workerIdleSeconds: 120,
      runTimeoutSeconds: 900,
      maxTurns: 12,
    },
    aspects: { ...full.aspects, ...previous.aspects },
  });
  assert.deepEqual(resolveConfig(saved), before);
  const { maxTurns: _removed, ...remainingLimits } = saved.limits;
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      ...saved,
      limits: remainingLimits,
      aspects: { "low-value-comments": false },
    }),
  );
  const updated = run(f.root);
  assert.equal(updated.status, 0, updated.stdout);
  assert.match(updated.stdout, /limits.maxTurns/);
  const updatedConfig = JSON.parse(
    readFileSync(join(f.root, ".degreaserrc.json"), "utf8"),
  );
  assert.equal(updatedConfig.limits.maxTurns, 40);
  assert.deepEqual(updatedConfig.aspects, {
    ...full.aspects,
    "low-value-comments": false,
  });
});

test("home, doctor and empty review disclose missing fields without modifying RC; sync clears the notice", (t) => {
  const f = fixture(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      ...full,
      limits: { workerTimeoutSeconds: 300, runTimeoutSeconds: 900 },
    }),
  );
  const path = join(f.root, ".degreaserrc.json");
  const before = readFileSync(path, "utf8");
  for (const args of [
    [],
    ["doctor"],
    ["review", "--scope", "worktree", "--task", "No changes"],
  ]) {
    const result = run(f.root, args);
    // Doctor can report unavailable native binaries; it still discloses config defaults.
    if (args[0] !== "doctor") assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /configurationNotice:/);
    assert.match(result.stdout, /limits.maxTurns/);
    assert.match(result.stdout, /40/);
    assert.match(result.stdout, /degreaser-axi config sync/);
    assert.equal(readFileSync(path, "utf8"), before);
  }
  assert.equal(run(f.root).status, 0);
  assert.doesNotMatch(run(f.root, []).stdout, /configurationNotice:/);
});

test("sync rejects invalid, future, missing and symlinked RC without replacing it", (t) => {
  const f = fixture(t);
  const path = join(f.root, ".degreaserrc.json");
  for (const text of [
    "{",
    JSON.stringify({ ...full, schemaVersion: 2 }),
    JSON.stringify({ ...full, extra: true }),
    JSON.stringify({ ...full, limits: { maxTruns: 40 } }),
    JSON.stringify({
      ...full,
      aspects: { enable: ["missed-reuse"], disable: ["missed-reuse"] },
    }),
  ]) {
    f.write(".degreaserrc.json", text);
    const result = run(f.root);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(readFileSync(path, "utf8"), text);
  }
  rmSync(path);
  assert.equal(run(f.root).status, 2);
  assert.equal(existsSync(path), false);
  f.write("target.json", JSON.stringify(full));
  symlinkSync(join(f.root, "target.json"), path);
  assert.equal(run(f.root).status, 2);
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(readFileSync(path, "utf8"), JSON.stringify(full));
});

test("sync requires exact arguments and never writes from worker sessions", (t) => {
  const f = fixture(t);
  const path = join(f.root, ".degreaserrc.json");
  const before = readFileSync(path, "utf8");
  for (const args of [
    ["config", "unknown"],
    ["config", "sync", "extra"],
    ["config", "sync", "--force"],
  ]) {
    assert.equal(run(f.root, args).status, 2);
    assert.equal(readFileSync(path, "utf8"), before);
  }
  assert.equal(run(f.root, ["config", "sync"], true).status, 2);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(run(f.root, ["config", "sync", "--help"]).status, 0);
});
