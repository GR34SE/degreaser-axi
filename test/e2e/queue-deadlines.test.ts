import assert from "node:assert/strict";

import { spawn } from "node:child_process";

import { once } from "node:events";

import test from "node:test";

import { ASPECT, review } from "../utils/coverage-fixture.ts";

import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

import { clean, finding } from "../utils/queue-results.ts";

for (const [label, results, expected] of [
  ["all no-findings", {}, "completed"],
  [
    "all not-applicable",
    {
      "masked-errors": {
        aspect: "masked-errors",
        status: "not-applicable",
        findings: [],
        limitations: [],
        reason: "No error handling.",
      },
      "low-value-comments": {
        ...clean,
        status: "not-applicable",
        reason: "No explanatory comments.",
      },
    },
    "completed",
  ],
  [
    "with findings",
    {
      "low-value-comments": {
        ...clean,
        status: "findings",
        findings: [finding],
      },
    },
    "completed",
  ],
  [
    "self-reported incomplete with zero findings",
    {
      "masked-errors": {
        aspect: "masked-errors",
        status: "incomplete",
        findings: [],
        limitations: ["Callers unavailable."],
      },
      "low-value-comments": {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [],
        limitations: ["Callers unavailable."],
      },
    },
    "completed",
  ],
  [
    "self-reported incomplete with evidence",
    {
      "low-value-comments": {
        ...clean,
        status: "incomplete",
        findings: [finding],
        limitations: ["Callers unavailable."],
      },
    },
    "completed",
  ],
  ["useful plus malformed", { "low-value-comments": "" }, "partial"],
  [
    "all malformed",
    { "masked-errors": "", "low-value-comments": "" },
    "failed",
  ],
  [
    "wrong aspect",
    {
      "masked-errors": clean,
      "low-value-comments": { ...clean, aspect: "masked-errors" },
    },
    "failed",
  ],
] as const) {
  test(`terminal matrix: ${label}`, (t) => {
    const f = queueFixture(t);
    f.setPlan({ results });
    f.start(["--aspects", "masked-errors,low-value-comments"]);
    const done = f.finish();
    assert.equal(done.status, expected === "completed" ? 0 : 1, done.stdout);
    assert.equal(f.state().status, expected);
  });
}

for (const useful of [false, true]) {
  test(`deadline spans retries and queued work with ${useful ? "useful" : "no useful"} results`, async (t) => {
    const sentinel = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { stdio: "ignore" },
    );
    t.after(async () => {
      sentinel.kill();
      await once(sentinel, "exit");
    });
    const maxRetries = 10;
    const f = queueFixture(t, {
      concurrency: 1,
      maxRetries,
      // The budget must still hold an idle-stopped attempt plus its retry
      // after a slow hosted runner's cold missed-reuse start.
      limits: {
        workerIdleSeconds: 2,
        workerTimeoutSeconds: 60,
        runTimeoutSeconds: 8,
      },
    });
    f.setPlan({
      workers: {
        "missed-reuse": useful ? {} : { hang: true, descendant: true },
        "speculative-flexibility": { hang: true, descendant: true },
        "unnecessary-layers": {},
      },
    });
    const start = Date.now();
    f.start([
      "--aspects",
      "missed-reuse,speculative-flexibility,unnecessary-layers",
    ]);
    const originalDeadline = f.state().deadline;
    const done = f.finish();
    const state = f.state();
    assert.equal(done.status, 1, done.stdout);
    assert.equal(state.status, useful ? "partial" : "failed");
    assert.equal(state.executions?.at(-1)?.stopReason, "deadline");
    assert.equal(state.deadline, originalDeadline);
    assert.ok(Date.now() - start < 14000, "Errors cannot reset the run budget");
    if (useful) {
      const completed = state.tasks[0];
      assert.equal(completed?.assignment.aspect, "missed-reuse");
      assert.equal(completed?.status, "no-findings");
      assert.equal(completed?.result?.status, "no-findings");
      assert.equal(completed?.attempts.length, 1);
      assert.equal(completed?.attempts[0]?.failure, null);
    }
    const unfinished = state.tasks.slice(useful ? 1 : 0);
    assert.ok(unfinished.every((task) => task.status === "cancelled"));
    assert.ok(
      unfinished.every((task) =>
        task.limitations.some((l) => l.includes("deadline")),
      ),
    );
    const retrying = unfinished[0];
    assert.ok(retrying);
    assert.ok(
      retrying.attempts.length > 1,
      "An idle-stopped attempt was retried",
    );
    assert.ok(retrying.attempts.length <= 1 + maxRetries);
    assert.ok(
      retrying.attempts
        .slice(0, -1)
        .every((a) => a.failure === "timeout" && a.diagnostic?.stop === "idle"),
    );
    assert.equal(state.tasks[2]?.attempts.length, 0);
    assert.ok(
      state.tasks
        .flatMap((task) => task.attempts)
        .every((a) => a.startedAt < originalDeadline),
    );
    assert.ok(sentinel.pid);
    assert.ok(alive(sentinel.pid));
    const owner = state.owner;
    assert.ok(owner);
    await until(() => !alive(owner.pid), "Owner exits after deadline");
    for (const e of f.lifecycle()) {
      assert.ok(!alive(e.pid));
      if (e.childPid) assert.ok(!alive(e.childPid));
    }
  });
}

test("a finder stopped at its own time ceiling is not retried; an idle stop is", (t) => {
  const ceiling = queueFixture(t, {
    maxRetries: 3,
    limits: { workerTimeoutSeconds: 2, workerIdleSeconds: 60 },
  });
  ceiling.setPlan({ workers: { [ASPECT]: { hang: true } } });
  const stopped = review(ceiling).task;
  assert.equal(stopped.attempts.length, 1);
  assert.equal(stopped.attempts[0]?.failure, "timeout");
  assert.equal(stopped.attempts[0]?.diagnostic?.stop, "ceiling");
  assert.deepEqual(stopped.unresolved, { cause: "timeout" });

  const idle = queueFixture(t, {
    maxRetries: 1,
    limits: { workerTimeoutSeconds: 60, workerIdleSeconds: 1 },
  });
  idle.setPlan({ workers: { [ASPECT]: { hang: true } } });
  assert.deepEqual(
    review(idle).task.attempts.map((a) => a.diagnostic?.stop),
    ["idle", "idle"],
  );
});
