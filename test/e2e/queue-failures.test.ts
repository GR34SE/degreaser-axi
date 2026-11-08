import assert from "node:assert/strict";

import test from "node:test";

import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

import { clean, finding } from "../utils/queue-results.ts";

for (const [name, error, expected] of [
  [
    "structured authentication",
    {
      message: "Quota exhausted in policy service",
      data: { authRequired: true },
    },
    "authentication",
  ],
  ["unknown model", { message: "Model not found" }, "model-unavailable"],
  ["quota exhaustion", { message: "Quota exhausted" }, "rate-limited"],
  [
    "permission denial",
    { message: "Permission denied" },
    "environment-blocked",
  ],
  [
    "unrelated 429",
    { message: "Cannot decode record 429 in provider response" },
    "runtime",
  ],
  ["disabled account", { message: "Account disabled" }, "account-disabled"],
] as const) {
  test(`${name} is classified without retries, identity fallback or lost peers`, (t) => {
    const f = queueFixture(t, { maxRetries: 3, concurrency: 2 });
    f.setPlan({ workers: { "low-value-comments": { error } } });
    f.start(["--aspects", "masked-errors,low-value-comments"]);
    const done = f.finish();
    assert.equal(done.status, 1, done.stdout);
    assert.equal(f.state().status, "partial");
    assert.equal(f.state().tasks[0]?.status, "no-findings");
    assert.equal(f.state().tasks[1]?.attempts.length, 1);
    assert.equal(f.state().tasks[1]?.attempts[0]?.failure, expected);
    const diagnostic = f.state().tasks[1]?.attempts[0]?.diagnostic;
    assert.equal(diagnostic?.stage, "turn-result");
    assert.equal(
      diagnostic?.recovery,
      {
        authentication: "fix-authentication",
        "model-unavailable": "change-model",
        "rate-limited": "wait-for-quota",
        "environment-blocked": "fix-environment",
        "account-disabled": "fix-account",
        runtime: "inspect",
      }[expected],
    );
    assert.ok(
      !JSON.stringify(diagnostic).match(
        /Quota exhausted|Model not found|Permission denied|Account disabled/,
      ),
    );
    assert.match(f.run(["report"]).stdout, /cause:/);
    assert.ok(
      f.events().every((e) => e.agent === "codex" && e.model === "gpt-6-luna"),
    );
    if (expected === "rate-limited")
      assert.ok(
        done.stdout.includes(
          `degreaser-axi resume ${f.state().id} --concurrency 1`,
        ),
      );
    else assert.ok(!done.stdout.includes("--concurrency 1"));
    if (expected === "account-disabled")
      assert.match(done.stdout, /Restore access to the selected account/);
  });
}

for (const [stop, message, expected, afterEvidence] of [
  ["cancelled", "Quota exhausted", "rate-limited", false],
  ["deadline", "Quota exhausted", "rate-limited", false],
  ["cancelled", "Cannot decode provider response", "runtime", false],
  ["cancelled", "Quota exhausted", "rate-limited", true],
] as const) {
  test(`${expected} provider failure survives ${stop} during cleanup with useful peers${afterEvidence ? " and its own evidence" : ""}`, async (t) => {
    const f = queueFixture(t, {
      concurrency: 2,
      maxRetries: 3,
      limits: {
        workerTimeoutSeconds: 15,
        runTimeoutSeconds: stop === "deadline" ? 6 : 30,
      },
    });
    f.setPlan({
      workers: {
        "low-value-comments": {
          resultGate: f.gate("fail"),
          [afterEvidence ? "afterError" : "error"]: {
            message: `${message}; private-provider-diagnostic`,
          },
          closeHang: true,
          descendant: true,
        },
      },
    });
    f.start(["--aspects", "masked-errors,low-value-comments"]);
    await until(
      () => f.state().tasks[0]?.status === "no-findings",
      "Peer result committed before provider fault",
    );
    f.release("fail");
    await until(
      () =>
        f
          .lifecycle()
          .some((e) => e.aspect === "low-value-comments" && e.type === "close"),
      "Provider fault reached cleanup",
    );
    const done =
      stop === "cancelled" ? f.run(["cancel", f.state().id]) : f.finish();
    assert.equal(done.status, 1, done.stdout);
    const state = f.state();
    assert.equal(state.status, "partial");
    assert.equal(state.tasks[0]?.status, "no-findings");
    const attempt = state.tasks[1]?.attempts[0];
    assert.equal(attempt?.failure, expected);
    assert.equal(state.tasks[1]?.attempts.length, 1);
    assert.equal(
      state.tasks[1]?.status,
      afterEvidence ? "incomplete" : "cancelled",
    );
    assert.equal(
      state.tasks[1]?.result?.status ?? null,
      afterEvidence ? "incomplete" : null,
    );
    assert.equal(state.executions?.at(-1)?.stopReason, stop);
    const report = f.run(["report", state.id, "--full"]);
    assert.match(report.stdout, new RegExp(expected));
    assert.match(report.stdout, new RegExp(`stopReason: ${stop}`));
    assert.ok(!JSON.stringify(state).includes("private-provider-diagnostic"));
    assert.ok(!report.stdout.includes("private-provider-diagnostic"));
    const owner = state.owner;
    assert.ok(owner);
    await until(
      () => !alive(owner.pid),
      "Stopped owner exits after joining cleanup",
    );
    for (const e of f.lifecycle()) {
      assert.ok(!alive(e.pid));
      if (e.childPid) assert.ok(!alive(e.childPid));
    }
  });
}

for (const [name, worker, status, failure] of [
  ["unsupported close", {}, "completed", null],
  [
    "denial after valid evidence",
    { afterError: { message: "Permission denied" } },
    "completed",
    null,
  ],
  [
    "failed close after valid evidence",
    { closeError: { message: "Synthetic close failure", code: -32603 } },
    "partial",
    "cleanup",
  ],
  [
    "hanging close after valid evidence",
    { closeHang: true },
    "partial",
    "cleanup",
  ],
] as const) {
  test(`${name} has an explicit lifecycle/evidence disposition`, (t) => {
    const f = queueFixture(t, {
      agent: "pi",
      model: "openai/gpt-6-luna",
      maxRetries: 2,
      limits: { workerTimeoutSeconds: 3, runTimeoutSeconds: 12 },
    });
    f.setPlan({
      worker: {
        ...worker,
        result: { ...clean, status: "findings", findings: [finding] },
      },
    });
    f.start(["--aspects", "low-value-comments"]);
    const done = f.finish();
    assert.equal(done.status, status === "completed" ? 0 : 1, done.stdout);
    assert.equal(f.state().status, status);
    const task = f.state().tasks[0];
    assert.ok(task);
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0]?.failure, failure);
    if (failure)
      assert.ok(
        f.lifecycle().some((e) => e.type === "close"),
        "A real close request failed, not a fabricated outcome",
      );
    assert.equal(
      task.result?.findings.length,
      1,
      "Useful evidence survives lifecycle errors",
    );
    assert.equal(
      task.status,
      status === "completed" ? "findings" : "incomplete",
    );
    if (failure) assert.match(done.stdout, /cleanup/);
  });
}
