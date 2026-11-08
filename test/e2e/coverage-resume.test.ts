import assert from "node:assert/strict";

import { readFileSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import test from "node:test";
import { openContext, pass, run, setup } from "../utils/coverage-fixture.ts";
import { queueFixture } from "../utils/queue-fixture.ts";

test("full declared coverage with a structured unresolved reason stays incomplete and resume targets it", (t) => {
  const f = setup(t, []);
  f.setPlan({ results: { "low-value-comments": openContext } });
  const task = run(f);
  assert.equal(task.status, "incomplete");
  assert.equal(task.attempts.length, 1);
  assert.deepEqual(task.result.examinedPaths, ["a.ts", "b.ts", "source.ts"]);
  assert.deepEqual(task.unresolved, {
    cause: "declared-unresolved",
    paths: [],
  });
  assert.equal(f.state().status, "partial");
  const report = f.run(["report", f.state().id]);
  assert.equal(report.status, 1);
  assert.match(report.stdout, /stopCause: declared-unresolved/);
  assert.match(report.stdout, /Callers of the exported constant/);

  f.setPlan({
    workers: { "low-value-comments": { attempts: [pass("no-findings", [])] } },
  });
  const resumed = f.run([
    "resume",
    f.state().id,
    "--deadline",
    "20",
    "--wait",
    "20",
  ]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const after = f.state().tasks[0];
  assert.equal(after?.status, "findings");
  assert.equal(after?.result?.findings.length, 1);
  assert.equal(after?.result?.unresolved, undefined);
  assert.equal(after?.unresolved, undefined);
  const prompt = f.events().at(-1)?.prompt ?? "";
  const focus = prompt.slice(prompt.indexOf("# Unresolved obligations"));
  assert.match(focus, /Callers of the exported constant/);
  assert.match(focus, /paths\[1\]: b\.ts/);
  assert.doesNotMatch(prompt, /a\.ts|source\.ts/);
});

test("an incomplete resolving pass keeps the open obligation instead of dropping it", (t) => {
  const f = setup(t, []);
  f.setPlan({ results: { "low-value-comments": openContext } });
  run(f);
  f.setPlan({ results: { "low-value-comments": openContext } });
  const resumed = f.run([
    "resume",
    f.state().id,
    "--deadline",
    "20",
    "--wait",
    "20",
  ]);
  assert.equal(resumed.status, 1, resumed.stdout);
  const task = f.state().tasks[0];
  assert.equal(task?.status, "incomplete");
  assert.equal(task?.attempts.length, 2);
  assert.equal(task?.result?.findings.length, 1);
  assert.equal(task?.result?.unresolved?.length, 1);
});

test("a legacy incomplete result without structured unresolved work stays readable and restarts the aspect", (t) => {
  const f = setup(t, []);
  f.setPlan({
    results: {
      "low-value-comments": {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [],
        limitations: ["One construct remains."],
      },
    },
  });
  run(f);
  const old = f.state();
  const path = join(f.root, ".degreaser/runs", old.id, "run.json");
  const legacy = JSON.parse(readFileSync(path, "utf8"));
  for (const task of legacy.tasks) {
    delete task.unresolved;
    delete task.result.unresolved;
    for (const attempt of task.attempts) delete attempt.result?.unresolved;
  }
  writeFileSync(path, JSON.stringify(legacy));
  assert.equal(f.run(["report", old.id]).status, 1);
  f.setPlan();
  const resumed = f.run(["resume", old.id, "--deadline", "20", "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const prompt = f.events().at(-1)?.prompt ?? "";
  assert.doesNotMatch(prompt, /Unresolved obligations|Focused coverage/);
  assert.equal(f.state().tasks[0]?.status, "no-findings");
});

test("a run deadline is reported as its own cause, keeps the pending paths and resume continues them", (t) => {
  const f = queueFixture(t, {
    concurrency: 1,
    limits: { maxTurns: 4, workerTimeoutSeconds: 60, runTimeoutSeconds: 6 },
  });
  for (const name of ["a", "b", "c", "d", "e"])
    f.write(`${name}.ts`, `export const ${name} = 1;\n`);
  f.setPlan({
    workers: {
      "low-value-comments": { attempts: [{}, { hang: true }] },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  f.finish();
  const old = f.state();
  const task = old.tasks[0];
  assert.equal(old.executions?.at(-1)?.stopReason, "deadline");
  assert.equal(task?.status, "cancelled");
  assert.equal(task?.result?.examinedPaths?.length, 2);
  assert.equal(task?.unresolved?.cause, "deadline");
  assert.equal(task?.unresolved?.paths.length, 4);
  assert.equal(task?.unresolved?.stuck, undefined);
  const report = f.run(["report", old.id]);
  assert.match(report.stdout, /stopCause: deadline/);
  assert.match(report.stdout, /pending: 4/);

  f.setPlan();
  const before = f.events().length;
  const resumed = f.run(["resume", old.id, "--deadline", "30", "--wait", "30"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const after = f.state().tasks[0];
  assert.equal(after?.status, "no-findings");
  assert.equal(after?.unresolved, undefined);
  assert.equal(after?.result?.examinedPaths?.length, 6);
  const first = f.events()[before]?.prompt ?? "";
  assert.match(first, /examined 2 paths/);
});

test("unresolved paths outside the assessed set are reported, not silently dropped", (t) => {
  const f = setup(t, []);
  f.setPlan({
    results: {
      "low-value-comments": {
        ...openContext,
        unresolved: [{ ...openContext.unresolved[0], paths: ["b.ts", "x.ts"] }],
      },
    },
  });
  const task = run(f);
  assert.deepEqual(task.result?.unresolved?.[0]?.paths, ["b.ts"]);
  assert.ok(
    task.result?.limitations.some((l: string) =>
      l.includes("outside the assessed set"),
    ),
  );
});
