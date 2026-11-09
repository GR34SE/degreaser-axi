import assert from "node:assert/strict";

import test from "node:test";

import { takePortion } from "../../src/review/ingest/coverage.ts";
import {
  pass,
  portionSizes,
  run,
  writeSeries,
} from "../utils/coverage-fixture.ts";
import { queueFixture } from "../utils/queue-fixture.ts";

test("a path of unknown size is taken alone, not as zero bytes", () => {
  const sizes = new Map([["a.ts", 10]]);
  assert.deepEqual(takePortion(["a.ts", "gone.ts", "b.ts"], sizes, 9, 100), [
    "a.ts",
  ]);
  assert.deepEqual(takePortion(["gone.ts", "a.ts"], sizes, 9, 100), [
    "gone.ts",
  ]);
});

test("synthetic scheduling: empty portions shrink and a later full portion grows one step, not back to the failed size", (t) => {
  const f = queueFixture(t, {
    limits: { maxTurns: 16, workerTimeoutSeconds: 15, runTimeoutSeconds: 60 },
  });
  const names = writeSeries(f, 15);
  const covered = pass("no-findings", names);
  f.setPlan({
    workers: {
      "low-value-comments": {
        attempts: [
          pass("incomplete", []),
          pass("incomplete", []),
          pass("incomplete", []),
          covered,
          covered,
          covered,
          covered,
          covered,
        ],
      },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  f.run(["wait", f.state().id, "--wait", "60"]);
  const task = f.state().tasks[0];
  assert.ok(task?.result);
  assert.deepEqual(portionSizes(f.events()), [
    "8",
    "4",
    "2",
    "1",
    "2",
    "4",
    "8",
    "1",
  ]);
  assert.equal(task.status, "no-findings");
  assert.equal(task.unresolved, undefined);
  assert.equal(task.attempts.length, 8);
  assert.equal(task.result.examinedPaths?.length, names.length);
  assert.equal(f.state().status, "completed");
});

test("synthetic scheduling: partial coverage keeps the reduced allowance", (t) => {
  const f = queueFixture(t, {
    limits: { maxTurns: 8, workerTimeoutSeconds: 15, runTimeoutSeconds: 30 },
  });
  const names = writeSeries(f, 7);
  const covered = pass("no-findings", names);
  f.setPlan({
    workers: {
      "low-value-comments": {
        attempts: [
          pass("incomplete", []),
          pass("incomplete", ["f00.ts"]),
          covered,
          covered,
          covered,
        ],
      },
    },
  });
  const task = run(f);
  assert.match(f.events()[1]?.prompt ?? "", /paths\[2\]: f00\.ts,f01\.ts/);
  assert.deepEqual(portionSizes(f.events()), ["4", "2", "2", "4", "1"]);
  assert.equal(task.status, "no-findings");
  assert.equal(task.attempts.length, 5);
  assert.equal(task.result.examinedPaths?.length, names.length);
});

test("synthetic scheduling: a path with no progress alone stays incomplete while later portions grow", (t) => {
  const f = queueFixture(t, {
    limits: { maxTurns: 4, workerTimeoutSeconds: 15, runTimeoutSeconds: 30 },
  });
  const names = writeSeries(f, 4);
  const covered = pass("no-findings", names);
  f.setPlan({
    workers: {
      "low-value-comments": {
        attempts: [
          pass("incomplete", []),
          pass("incomplete", []),
          covered,
          covered,
          covered,
        ],
      },
    },
  });
  const task = run(f);
  assert.deepEqual(portionSizes(f.events()), ["2", "1", "1", "2", "1"]);
  assert.equal(task.attempts.length, 5);
  assert.equal(task.status, "incomplete");
  assert.deepEqual(task.result.examinedPaths, [
    "f01.ts",
    "f02.ts",
    "f03.ts",
    "source.ts",
  ]);
  assert.deepEqual(task.unresolved, {
    cause: "no-progress",
    paths: ["f00.ts"],
    stuck: ["f00.ts"],
  });
  assert.equal(f.state().status, "partial");
  const report = f.run(["report", f.state().id, "--full"]);
  assert.equal(report.status, 1);
  assert.match(report.stdout, /no-progress/);
});

test("synthetic scheduling: a deadline after a recovered portion stays a deadline and resume finishes the pending paths", (t) => {
  const f = queueFixture(t, {
    concurrency: 1,
    limits: { maxTurns: 4, workerTimeoutSeconds: 60, runTimeoutSeconds: 8 },
  });
  const names = writeSeries(f, 5);
  f.setPlan({
    workers: {
      "low-value-comments": {
        attempts: [
          pass("incomplete", []),
          pass("no-findings", names),
          { hang: true },
        ],
      },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  f.finish();
  const old = f.state();
  const task = old.tasks[0];
  assert.deepEqual(portionSizes(f.events()), ["2", "1", "2"]);
  assert.equal(old.executions?.at(-1)?.stopReason, "deadline");
  assert.equal(task?.status, "cancelled");
  assert.equal(task?.result?.examinedPaths?.length, 1);
  assert.equal(task?.unresolved?.cause, "deadline");
  assert.equal(task?.unresolved?.paths.length, 5);
  assert.equal(task?.unresolved?.stuck, undefined);
  const report = f.run(["report", old.id]);
  assert.equal(report.status, 1);
  assert.match(report.stdout, /stopCause: deadline/);

  f.setPlan();
  const before = f.events().length;
  const resumed = f.run(["resume", old.id, "--deadline", "30", "--wait", "30"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const after = f.state().tasks[0];
  assert.equal(after?.status, "no-findings");
  assert.equal(after?.unresolved, undefined);
  assert.equal(after?.result?.examinedPaths?.length, names.length);
  assert.match(f.events()[before]?.prompt ?? "", /paths\[2\]:/);
});
