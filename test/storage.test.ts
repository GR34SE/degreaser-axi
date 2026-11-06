import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { prepareReview } from "../src/input.ts";
import {
  createRun,
  loadRun,
  type Run,
  type RunTask,
  StateError,
  saveRun,
} from "../src/storage.ts";
import { fixture } from "./git-fixture.ts";
import { queueFixture } from "./queue-fixture.ts";

test("pre-write run validation rejects invalid structures, versions and embedded result relationships without replacement", (t) => {
  const f = fixture(t);
  f.write("source.ts", "export const value = 1;\n");
  const original = createRun(
    prepareReview(
      [
        "--scope",
        "worktree",
        "--task",
        "Update",
        "--aspects",
        "masked-errors,low-value-comments",
      ],
      f.root,
    ),
  );
  const path = join(f.root, ".degreaser/runs", original.id, "run.json");
  const bytes = readFileSync(path);
  const mutations: ((run: Run, task: RunTask) => void)[] = [
    (run) => Object.assign(run, { schemaVersion: 2 }),
    (_run, task) => Object.assign(task, { attempts: "not an array" }),
    (_run, task) => Object.assign(task, { status: "no-findings" }),
    (_run, task) =>
      Object.assign(task, {
        result: {
          aspect: "masked-errors",
          status: "findings",
          findings: [],
          limitations: [],
        },
      }),
    (_run, task) =>
      Object.assign(task, {
        status: "no-findings",
        result: {
          aspect: "low-value-comments",
          status: "no-findings",
          findings: [],
          limitations: [],
        },
      }),
    (run) => Object.assign(run, { status: "completed" }),
    (run) =>
      Object.assign(run, {
        executions: [
          {
            startedAt: 1,
            deadline: 2,
            concurrency: 1,
            waitSeconds: 1,
            failure: { code: "owner-failed", message: 42 },
          },
        ],
      }),
    (run, task) => {
      run.tasks[1] = structuredClone(task);
    },
  ];
  for (const mutate of mutations) {
    const run = structuredClone(original);
    const task = run.tasks[0];
    assert.ok(task);
    mutate(run, task);
    try {
      assert.throws(
        () => saveRun(run),
        (error) => error instanceof StateError && error.message.includes(path),
      );
      assert.deepEqual(readFileSync(path), bytes);
    } finally {
      writeFileSync(path, bytes);
    }
  }
  assert.equal(loadRun(f.root, original.id).tasks.length, 2);
});

test("malformed, structurally invalid and unsupported project config fails even on home without writes or model calls", (t) => {
  const f = queueFixture(t);
  for (const config of [
    "{",
    '{"agent":"codex","model":1}',
    '{"schemaVersion":99,"agent":"codex","model":"gpt-6-luna"}',
  ]) {
    f.write(".degreaserrc.json", config);
    for (const args of [
      [],
      ["home"],
      ["doctor"],
      ["review", "--scope", "worktree", "--task", "Update"],
    ]) {
      const result = f.run(args);
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stdout, /\.degreaserrc\.json/);
      assert.equal(
        readFileSync(join(f.root, ".degreaserrc.json"), "utf8"),
        config,
      );
    }
  }
  assert.deepEqual(f.events(), []);
});

test("a valid in-memory run cannot overwrite a damaged authoritative destination", (t) => {
  const f = fixture(t);
  f.write("source.ts", "export const value = 1;\n");
  const run = createRun(
    prepareReview(
      [
        "--scope",
        "worktree",
        "--task",
        "Update",
        "--aspects",
        "low-value-comments",
      ],
      f.root,
    ),
  );
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  for (const damaged of ["{", JSON.stringify({ ...run, schemaVersion: 999 })]) {
    writeFileSync(path, damaged);
    assert.throws(
      () => saveRun(run),
      (error) => error instanceof StateError && error.message.includes(path),
    );
    assert.equal(readFileSync(path, "utf8"), damaged);
  }
});

test("invalid input writes fail by filename before allocating a run or replacing prior history", (t) => {
  const f = fixture(t);
  f.write("source.ts", "export const value = 1;\n");
  const input = prepareReview(
    [
      "--scope",
      "worktree",
      "--task",
      "Update",
      "--aspects",
      "low-value-comments",
    ],
    f.root,
  );
  const run = createRun(input);
  const latest = join(f.root, ".degreaser/state.json");
  const previous = readFileSync(latest);
  for (const invalid of [
    { ...input, schemaVersion: 99 },
    { ...input, config: { ...input.config, maxRetries: "1" } },
    {
      ...input,
      coordinatorResults: [
        { aspect: "low-value-comments", status: "no-findings" },
      ],
    },
  ]) {
    assert.throws(
      () => createRun(Object.assign(structuredClone(input), invalid)),
      (error) =>
        error instanceof StateError &&
        error.message.includes("input/review.json"),
    );
    assert.deepEqual(readFileSync(latest), previous);
    assert.deepEqual(readdirSync(join(f.root, ".degreaser/runs")), [run.id]);
    assert.deepEqual(loadRun(f.root, run.id), run);
  }
});

test("compiled readers reject corruption at every authoritative JSON layer without changing history or starting workers", (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  const sibling = f.state();
  f.start(["--aspects", "masked-errors"]);
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const root = join(f.root, ".degreaser");
  const directory = join(root, "runs", run.id);
  const files = [
    join(root, "state.json"),
    join(directory, "run.json"),
    join(directory, "input/review.json"),
    join(directory, "input/patch.json"),
  ];
  const siblingPath = join(root, "runs", sibling.id, "run.json");
  const siblingBytes = readFileSync(siblingPath);
  const events = f.events();
  for (const [index, path] of files.entries()) {
    const original = readFileSync(path);
    const value = JSON.parse(original.toString());
    const cases = [
      "{",
      JSON.stringify({ unexpected: true }),
      JSON.stringify({ ...value, schemaVersion: 99 }),
    ];
    if (path.endsWith("/run.json")) {
      const invalid = structuredClone(value);
      invalid.tasks[0].result.limitations = 42;
      cases.push(JSON.stringify(invalid));
      const failure = structuredClone(value);
      failure.executions[0].failure = { code: "owner-failed" };
      cases.push(JSON.stringify(failure));
    }
    for (const damaged of cases) {
      try {
        writeFileSync(path, damaged);
        for (const args of [
          ["report"],
          ["wait", run.id, "--wait", "1"],
          ["finding", "F1"],
          ["home"],
        ]) {
          // Explicit run IDs do not use the latest-run pointer.
          if (index === 0 && args[0] === "wait") continue;
          const result = f.run(args);
          assert.equal(
            result.status,
            2,
            `${path}: ${args.join(" ")}\n${result.stdout}`,
          );
          assert.ok(result.stdout.includes(path), result.stdout);
          assert.match(result.stdout, /state-corrupt/);
          assert.equal(readFileSync(path, "utf8"), damaged);
        }
        assert.deepEqual(readFileSync(siblingPath), siblingBytes);
        assert.deepEqual(f.events(), events);
      } finally {
        writeFileSync(path, original);
      }
    }
  }
});

test("new review rejects damaged latest history before model discovery or publishing another run", (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const root = join(f.root, ".degreaser");
  const latest = readFileSync(join(root, "state.json"));
  const path = join(root, "runs", run.id, "input/review.json");
  const original = readFileSync(path);
  const lifecycle = readFileSync(f.gate("lifecycle.jsonl"));
  try {
    writeFileSync(path, "{");
    const result = f.start(["--aspects", "low-value-comments"]);
    assert.equal(result.status, 2, result.stdout);
    assert.ok(result.stdout.includes(path), result.stdout);
    assert.deepEqual(readFileSync(join(root, "state.json")), latest);
    assert.deepEqual(readdirSync(join(root, "runs")), [run.id]);
    assert.deepEqual(readFileSync(f.gate("lifecycle.jsonl")), lifecycle);
    assert.equal(readFileSync(path, "utf8"), "{");
  } finally {
    writeFileSync(path, original);
  }
});
