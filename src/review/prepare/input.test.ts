import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveConfig } from "../../../test/utils/config.ts";
import { fixture } from "../../../test/utils/git-fixture.ts";
import { prepareReview } from "../../../test/utils/input.ts";

const all = [
  "unnecessary-complexity",
  "masked-errors",
  "verification-theater",
  "contract-bypass",
  "incomplete-integration",
  "stale-references",
  "low-value-tests",
  "scope-creep",
  "reinvented-infrastructure",
  "missed-reuse",
  "wrong-abstraction",
  "structural-erosion",
  "speculative-flexibility",
  "unnecessary-layers",
  "unjustified-defense",
  "convention-drift",
  "unidiomatic-code",
  "low-value-comments",
];
const identity = { agent: "codex", model: "gpt-6-luna" };
const rcBase = { ...identity, verifier: { model: "gpt-6-sol" } };
const args = ["--scope", "worktree", "--task", "Add CSV import"];

test("invalid requests fail before creating run artifacts or changing the index", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.root, ".git/index"));
  for (const invalid of [
    [],
    ["--task", "hello"],
    ["--scope", "unknown", "--task", "hello"],
    ["--scope", "worktree"],
    ["--scope", "worktree", "--task", "  "],
    [...args, "--task-file", "brief"],
    [...args, "--scope", "branch"],
    ["--scope", "branch", "--task", "hello"],
    [...args, "--base", "HEAD"],
    [...args, "--scpoe", "worktree"],
    [...args, "--task", "second"],
    [...args, "extra"],
    [...args, "--wait", "0"],
    [...args, "--concurrency", "1.5"],
    [...args, "--aspects", ""],
    [...args, "--aspects", "masked-errors,masked-errors"],
    ["--scope", "worktree", "--task-file", "missing"],
  ]) {
    assert.throws(
      () => prepareReview(invalid, f.root),
      { name: /^(Input|Axi)Error$/ },
      JSON.stringify(invalid),
    );
    assert.equal(existsSync(join(f.root, ".degreaser")), false);
    assert.deepEqual(readFileSync(join(f.root, ".git/index")), before);
  }
  for (const text of ["", " \n "]) {
    f.write("brief", text);
    assert.throws(
      () =>
        prepareReview(["--scope", "worktree", "--task-file", "brief"], f.root),
      /nonempty/,
    );
  }
});

test("task files resolve from invocation cwd but configuration comes only from repository root", (t) => {
  const f = fixture(t);
  f.write("nested/brief", "First line\nSecond line\n");
  f.write("nested/.degreaserrc.json", '{"agent":"droid"}');
  const result = prepareReview(
    [
      "--scope",
      "worktree",
      "--task-file",
      "brief",
      "--aspects",
      "masked-errors",
      "--wait",
      "7",
    ],
    join(f.root, "nested"),
  );
  assert.equal(result.task, "First line\nSecond line\n");
  assert.equal(result.repository, f.root);
  assert.equal(result.waitSeconds, 7);
  assert.deepEqual(result.config.assignments, [
    { aspect: "masked-errors", ...identity },
  ]);
  assert.equal(existsSync(join(f.root, ".degreaser")), false);
  f.write(".degreaserrc.json", "{");
  assert.throws(() => prepareReview(args, f.root), /\.degreaserrc.json.*JSON/);
});

test("a parent's RC is not a configuration source for a nested repository", (t) => {
  const f = fixture(t);
  const child = join(f.root, "child");
  mkdirSync(child);
  assert.equal(spawnSync("git", ["init"], { cwd: child }).status, 0);
  assert.throws(() => prepareReview(args, child), /Root .degreaserrc.json/);
  assert.equal(existsSync(join(child, ".degreaser")), false);
});

test("strict public RC schema rejects unknown fields and bounded invalid values without coercion", () => {
  const invalid: unknown[] = [
    {},
    { agent: "codex" },
    { model: "gpt-6-luna" },
    ...["droid", "grok", "unknown"].map((agent) => ({ ...rcBase, agent })),
    ...[0, -1, 1.5, "2", Infinity, 9007199254740992].map((concurrency) => ({
      ...rcBase,
      concurrency,
    })),
    ...[-1, 1.5, null, 11].map((maxRetries) => ({ ...rcBase, maxRetries })),
    ...[0, -1, null, "40", 1.5].map((maxTurns) => ({
      ...rcBase,
      limits: { maxTurns },
    })),
    ...[0, -1, null, 2147484].map((workerTimeoutSeconds) => ({
      ...rcBase,
      limits: { workerTimeoutSeconds },
    })),
    { ...rcBase, schemaVersion: 2 },
    { ...rcBase, caller: "claude" },
    { ...rcBase, limits: { timeout: 1 } },
    { ...rcBase, aspects: { custom: [] } },
    { ...rcBase, aspects: { enable: ["missed-reuse"] } },
    { ...rcBase, aspects: { "missed-reuse": "off" } },
    { ...rcBase, aspects: { A17: { model: "x" } } },
    {
      ...rcBase,
      aspects: { "missed-reuse": { agent: "claude" } },
    },
    { ...rcBase, aspects: { "missed-reuse": {} } },
    { ...rcBase, model: " " },
    { agent: "pi", model: "unqualified", verifier: { model: "p/x" } },
    ...[
      "../outside",
      "/absolute",
      "src/**",
      "",
      "src/",
      "src/../x",
      "!src",
      "a\\b",
    ].map((path) => ({ ...rcBase, exclude: [path] })),
  ];
  for (const value of invalid) {
    assert.throws(() => resolveConfig(value), { name: /^(Input|Axi)Error$/ });
  }
  const bounded = resolveConfig({
    ...rcBase,
    schemaVersion: 1,
    concurrency: 32,
    maxRetries: 0,
  });
  assert.equal(bounded.concurrency, 32);
  assert.equal(bounded.maxRetries, 0);
  assert.deepEqual(
    resolveConfig({
      agent: "cursor",
      model: "composer-2.5-fast",
      verifier: { model: "composer-2.5-fast" },
    }).assignments[0],
    {
      aspect: "unnecessary-complexity",
      agent: "cursor",
      model: "composer-2.5-fast",
    },
  );
  assert.throws(
    () => resolveConfig({ ...rcBase, limits: { workerTimeoutSecons: 300 } }),
    /\.degreaserrc\.json: .*limits.*must NOT have additional properties/,
  );
});

test("selection narrows all eighteen defaults without re-enabling disabled aspects or mutating RC", () => {
  assert.deepEqual(
    resolveConfig(rcBase).assignments.map((a) => a.aspect),
    all,
  );
  const rc = {
    ...rcBase,
    concurrency: 2,
    aspects: {
      "unnecessary-layers": false,
      "masked-errors": { model: "exact-codex-id" },
      "contract-bypass": {
        agent: "claude",
        model: "claude-haiku-4-5-20251001",
      },
      "verification-theater": { agent: "pi", model: "openai/gpt-6-luna" },
    },
  };
  const original = JSON.stringify(rc);
  const config = resolveConfig(rc, {
    aspects: ["verification-theater", "contract-bypass", "masked-errors"],
    concurrency: 1,
  });
  assert.deepEqual(config.assignments, [
    { aspect: "masked-errors", agent: "codex", model: "exact-codex-id" },
    { aspect: "verification-theater", agent: "pi", model: "openai/gpt-6-luna" },
    {
      aspect: "contract-bypass",
      agent: "claude",
      model: "claude-haiku-4-5-20251001",
    },
  ]);
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxRetries, 1);
  assert.deepEqual(config.limits, {
    workerTimeoutSeconds: 900,
    workerIdleSeconds: 180,
    maxTurns: 40,
    runTimeoutSeconds: 1800,
  });
  assert.equal(JSON.stringify(rc), original);
  assert.equal(resolveConfig(rc).assignments.length, all.length - 1);
  assert.throws(
    () => resolveConfig(rc, { aspects: ["unnecessary-layers"] }),
    /disabled/,
  );
  assert.throws(
    () =>
      resolveConfig({
        ...rcBase,
        aspects: Object.fromEntries(all.map((id) => [id, false])),
      }),
    /empty/,
  );
  assert.throws(
    () => resolveConfig({ ...rcBase, aspects: { disable: ["scope-creep"] } }),
    /one entry per aspect/,
  );
  assert.throws(() => resolveConfig(rcBase, { aspects: ["A99"] }), /aspect/);
  assert.throws(() => resolveConfig(rcBase, { aspects: [] }), /empty/);
  assert.throws(
    () =>
      resolveConfig({
        ...rcBase,
        aspects: {
          "missed-reuse": { agent: "pi", model: "wrong" },
        },
      }),
    /\.degreaserrc\.json: .*model.*must match pattern/,
  );
  assert.throws(
    () =>
      resolveConfig({
        agent: "pi",
        model: "openai/gpt-6-luna",
        verifier: { model: "openai/gpt-6-sol" },
        aspects: { "missed-reuse": { model: "wrong" } },
      }),
    /provider/,
  );
});
