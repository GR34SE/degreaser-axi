import assert from "node:assert/strict";

import test from "node:test";

import { saveRun } from "../../src/state/store.ts";
import { pass, portionSizes, writeSeries } from "../utils/coverage-fixture.ts";
import { alive, queueFixture, until } from "../utils/queue-fixture.ts";
import { decode } from "../utils/report-fixture.ts";

test("reports distinguish portions from retries, sum usage over every attempt and suggest narrowing", async (t) => {
  const f = queueFixture(t, {
    maxRetries: 1,
    limits: { maxTurns: 8, workerTimeoutSeconds: 15, runTimeoutSeconds: 60 },
  });
  const names = writeSeries(f, 7);
  const covered = pass("no-findings", names);
  const usage = { inputTokens: 10, outputTokens: 2 };
  f.setPlan({
    workers: {
      "low-value-comments": {
        attempts: [
          { result: "", usage },
          { ...covered, usage },
          { ...covered, usage },
        ],
      },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  const done = f.finish();
  assert.equal(done.status, 0, done.stdout);
  assert.deepEqual(portionSizes(f.events()), ["4", "4", "4"]);
  const run = f.state();
  const task = run.tasks[0];
  assert.ok(task);
  assert.deepEqual(
    task.attempts.map((a) => [a.portion, a.failure]),
    [
      [{ index: 1, paths: 4 }, "invalid-output"],
      [{ index: 1, paths: 4 }, null],
      [{ index: 2, paths: 4 }, null],
    ],
  );

  const short = decode(f.run(["report"]).stdout);
  assert.equal(short.usageScope, "all-attempts-per-aspect");
  assert.deepEqual(short.usage, { inputTokens: 30, outputTokens: 6 });
  assert.equal(short.aspectUsage, undefined);
  assert.equal(short.coverage[0].portions, "2 (4/4)");
  assert.equal(
    short.help.filter((line: string) => /--path/.test(line)).length,
    1,
  );
  assert.match(
    short.help.find((line: string) => /--path/.test(line)),
    /exclude.*\.degreaserrc\.json/,
  );

  const full = decode(f.run(["report", "--full"]).stdout);
  assert.deepEqual(full.aspectUsage, [
    { aspect: "low-value-comments", inputTokens: 30, outputTokens: 6 },
  ]);
  assert.deepEqual(full.execution[0].usage, {
    inputTokens: 30,
    outputTokens: 6,
  });

  const owner = run.owner;
  if (owner) await until(() => !alive(owner.pid), "Owner exits");
  const first = task.attempts[0];
  assert.ok(first);
  first.usage = null;
  saveRun(run);
  const partial = decode(f.run(["report", "--full"]).stdout);
  assert.equal(partial.usage, "unknown");
  assert.equal(partial.aspectUsage, "unknown");
  assert.equal(partial.execution[0].usage, "unknown");

  for (const attempt of task.attempts) delete attempt.portion;
  saveRun(run);
  const legacy = f.run(["report"]);
  assert.equal(legacy.status, 0, legacy.stdout);
  assert.equal(decode(legacy.stdout).coverage[0].portions, undefined);
});

test("a single-portion review shows no portion line or narrowing hint", (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      "low-value-comments": { usage: { inputTokens: 5 } },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  const short = decode(f.run(["report"]).stdout);
  assert.equal(short.coverage[0].portions, undefined);
  assert.ok(!short.help.some((line: string) => /--path/.test(line)));
  assert.deepEqual(short.usage, { inputTokens: 5 });
});
