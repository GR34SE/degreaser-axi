import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Ajv } from "ajv";
import { assertSupportedModels, resolveConfig } from "../src/config.ts";
import { prepareReview } from "../src/input.ts";
import { validateReviewInput } from "../src/input-schema.ts";
import { fixture } from "./git-fixture.ts";

const all = [
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
  "A11",
  "A12",
  "A13",
  "A14",
  "A15",
  "A16",
];
const identity = { agent: "codex", model: "gpt-6-luna" };
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
    [...args, "--aspects", "A04,A04"],
    ["--scope", "worktree", "--task-file", "missing"],
  ]) {
    assert.throws(
      () => prepareReview(invalid, f.root),
      { name: "InputError" },
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
      "A04",
      "--wait",
      "7",
    ],
    join(f.root, "nested"),
  );
  assert.equal(result.task, "First line\nSecond line\n");
  assert.equal(result.repository, f.root);
  assert.equal(result.waitSeconds, 7);
  assert.deepEqual(result.config.assignments, [{ aspect: "A04", ...identity }]);
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
  const schema = JSON.parse(
    readFileSync(
      new URL("../assets/schemas/config-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const validate = new Ajv({ strict: true }).compile(schema);
  const invalid: unknown[] = [
    {},
    { agent: "codex" },
    { model: "gpt-6-luna" },
    ...["droid", "grok", "unknown"].map((agent) => ({ ...identity, agent })),
    ...[null, 0, -1, 1.5, "2", Infinity, 9007199254740992].map(
      (concurrency) => ({ ...identity, concurrency }),
    ),
    ...[-1, 1.5, null, 11].map((maxRetries) => ({ ...identity, maxRetries })),
    ...[0, -1, null, "40", 1.5].map((maxTurns) => ({
      ...identity,
      limits: { maxTurns },
    })),
    ...[0, -1, null, 2147484].map((workerTimeoutSeconds) => ({
      ...identity,
      limits: { workerTimeoutSeconds },
    })),
    { ...identity, schemaVersion: 2 },
    { ...identity, caller: "claude" },
    { ...identity, limits: { timeout: 1 } },
    { ...identity, aspects: { custom: [] } },
    { ...identity, aspects: { enable: ["reuse-existing"] } },
    { ...identity, aspects: { overrides: { A17: { model: "x" } } } },
    { ...identity, aspects: { overrides: { A01: { agent: "claude" } } } },
    { ...identity, aspects: { overrides: { A01: {} } } },
    { ...identity, model: " " },
    { agent: "pi", model: "unqualified" },
    ...[
      "../outside",
      "/absolute",
      "src/**",
      "",
      "src/",
      "src/../x",
      "!src",
      "a\\b",
    ].map((path) => ({ ...identity, exclude: [path] })),
  ];
  for (const value of invalid) {
    assert.equal(validate(value), false, JSON.stringify(value));
    assert.throws(() => resolveConfig(value), { name: "InputError" });
  }
  assert.equal(
    validate({ ...identity, schemaVersion: 1, concurrency: 32, maxRetries: 0 }),
    true,
  );
  assert.throws(
    () => resolveConfig({ ...identity, limits: { workerTimeoutSecons: 300 } }),
    /\.degreaserrc\.json: .*limits.*must NOT have additional properties/,
  );
});

test("selection narrows all sixteen defaults without re-enabling disabled aspects or mutating RC", () => {
  assert.deepEqual(
    resolveConfig(identity).assignments.map((a) => a.aspect),
    all,
  );
  const rc = {
    ...identity,
    concurrency: 2,
    aspects: {
      disable: ["A02"],
      overrides: {
        A04: { model: "exact-codex-id" },
        A09: { agent: "claude", model: "claude-haiku-4-5-20251001" },
        A16: { agent: "pi", model: "openai/gpt-6-luna" },
      },
    },
  };
  const original = JSON.stringify(rc);
  const config = resolveConfig(rc, {
    aspects: ["A16", "A09", "A04"],
    concurrency: 1,
  });
  assert.deepEqual(config.assignments, [
    { aspect: "A04", agent: "codex", model: "exact-codex-id" },
    { aspect: "A09", agent: "claude", model: "claude-haiku-4-5-20251001" },
    { aspect: "A16", agent: "pi", model: "openai/gpt-6-luna" },
  ]);
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxRetries, 1);
  assert.deepEqual(config.limits, {
    workerTimeoutSeconds: 300,
    maxTurns: 40,
    runTimeoutSeconds: 900,
  });
  assert.equal(JSON.stringify(rc), original);
  assert.equal(resolveConfig(rc).assignments.length, 15);
  assert.throws(() => resolveConfig(rc, { aspects: ["A02"] }), /disabled/);
  assert.throws(
    () =>
      resolveConfig({
        ...identity,
        aspects: { enable: ["A01"], disable: ["A01"] },
      }),
    /both/,
  );
  assert.throws(
    () => resolveConfig({ ...identity, aspects: { disable: all } }),
    /empty/,
  );
  assert.throws(() => resolveConfig(identity, { aspects: ["A99"] }), /aspect/);
  assert.throws(() => resolveConfig(identity, { aspects: [] }), /empty/);
  assert.throws(
    () =>
      resolveConfig({
        ...identity,
        aspects: { overrides: { A01: { agent: "pi", model: "wrong" } } },
      }),
    /\.degreaserrc\.json: .*model.*must match pattern/,
  );
  assert.throws(
    () =>
      resolveConfig({
        agent: "pi",
        model: "openai/gpt-6-luna",
        aspects: { overrides: { A01: { model: "wrong" } } },
      }),
    /provider/,
  );
  assertSupportedModels(config, [
    { agent: "codex", model: "exact-codex-id" },
    { agent: "claude", model: "claude-haiku-4-5-20251001" },
    { agent: "pi", model: "openai/gpt-6-luna" },
  ]);
  assert.throws(
    () =>
      assertSupportedModels(config, [
        { agent: "codex", model: "exact-codex-id" },
      ]),
    /A09.*not available/,
  );
  assert.throws(
    () =>
      assertSupportedModels(
        resolveConfig({ agent: "claude", model: "gpt-6-luna" }),
        [{ agent: "codex", model: "gpt-6-luna" }],
      ),
    /not available/,
  );
});

test("resolved input round-trips through its shipped versioned schema without inventing an audit patch", (t) => {
  const f = fixture(t);
  f.write("source", "source evidence\n");
  for (const scope of ["worktree", "branch", "repository"]) {
    const request = ["--scope", scope, "--task", "Review source"];
    if (scope === "branch") request.push("--base", "main");
    const resolved = prepareReview(request, f.root);
    const saved = JSON.parse(JSON.stringify(resolved));
    assert.deepEqual(validateReviewInput(saved), resolved);
    for (const invalid of [
      { ...saved, schemaVersion: 2 },
      { ...saved, tree: "missing" },
      { ...saved, scope: "implicit" },
      { ...saved, unknown: true },
      { ...saved, paths: [{ ...saved.paths[0], path: "../outside" }] },
      { ...saved, patch: scope === "repository" ? "invented diff" : null },
    ])
      assert.throws(() => validateReviewInput(invalid), { name: "InputError" });
  }
});
