import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { alive, queueFixture, until } from "./queue-fixture.ts";

const clean = {
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  limitations: [],
  examinedPaths: ["source.ts"],
};
const cleanBlock = `<degreaser-result>${JSON.stringify(clean)}</degreaser-result>`;
const atLimit = cleanBlock + "x".repeat(1_048_576 - cleanBlock.length);
const oversized = `${atLimit}x`;
const finding = {
  location: { path: "source.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "// redundant",
  title: "Repeated comment",
  evidence: "The comment repeats the declaration.",
  consequence: "Extra maintenance.",
  countercheck: "No hidden rationale.",
  recommendation: "Remove it.",
};

for (const [name, worker, retries, count, status] of [
  ["missing output exhausts", { result: "" }, 2, 3, "failed"],
  [
    "malformed output exhausts",
    { result: "<degreaser-result>{bad</degreaser-result>" },
    1,
    2,
    "failed",
  ],
  ["zero disables retries", { result: "" }, 0, 1, "failed"],
  ["output at the limit is accepted", { result: atLimit }, 1, 1, "completed"],
  ["oversized output exhausts", { result: oversized }, 1, 2, "failed"],
  ["oversized zero disables retries", { result: oversized }, 0, 1, "failed"],
  [
    "oversized output recovers",
    { attempts: [{ result: oversized }, { result: clean }] },
    2,
    2,
    "completed",
  ],
  [
    "valid output stops retries",
    { attempts: [{ result: "" }, { result: clean }, { result: "" }] },
    3,
    2,
    "completed",
  ],
  [
    "incomplete waits for explicit resume",
    {
      result: {
        ...clean,
        status: "incomplete",
        limitations: ["Unexamined call sites."],
      },
    },
    3,
    1,
    "partial",
  ],
  ["startup timeout exhausts", { startupHang: true }, 1, 2, "failed"],
  [
    "inference timeout exhausts",
    { hang: true, descendant: true },
    1,
    2,
    "failed",
  ],
] as const) {
  test(name, (t) => {
    const f = queueFixture(t, {
      maxRetries: retries,
      concurrency: 1,
      limits: {
        workerTimeoutSeconds: name.includes("timeout") ? 1 : 5,
        runTimeoutSeconds: 20,
      },
    });
    f.setPlan({ worker });
    f.start(["--aspects", "low-value-comments"]);
    const done = f.finish();
    assert.equal(done.status, status === "completed" ? 0 : 1, done.stdout);
    const task = f.state().tasks[0];
    assert.ok(task);
    assert.equal(f.state().status, status);
    assert.equal(task.attempts.length, count);
    assert.equal(
      f.lifecycle().filter((e) => e.type === "initialize").length,
      count,
    );
    const calls = f.events();
    assert.equal(calls.length, name.startsWith("startup") ? 0 : count);
    assert.equal(new Set(calls.map((e) => e.sessionId)).size, calls.length);
    assert.ok(
      calls.every(
        (e) =>
          e.prompt === calls[0]?.prompt &&
          e.model === "gpt-6-luna" &&
          e.agent === "codex",
      ),
    );
    for (let i = 1; i < task.attempts.length; i++) {
      const current = task.attempts[i],
        previous = task.attempts[i - 1];
      assert.ok(current && previous?.endedAt);
      assert.ok(current.startedAt >= previous.endedAt);
    }
    if (name.includes("timeout"))
      assert.ok(task.attempts.every((a) => a.failure === "timeout"));
    if (name.startsWith("oversized")) {
      for (const attempt of name.endsWith("recovers")
        ? task.attempts.slice(0, 1)
        : task.attempts) {
        assert.equal(attempt.failure, "output-limit");
        assert.equal(attempt.result, null);
      }
      assert.ok(JSON.stringify(f.state()).length < 50_000);
      assert.ok(!done.stdout.includes("x".repeat(100)));
    }
  });
}

for (const [label, worker, expected, cancel, status] of [
  [
    "provider fault and cancel",
    { error: { message: "Quota exhausted" }, closeHang: true },
    "rate-limited",
    true,
    "cancelled",
  ],
  ["oversized output", { result: oversized }, "output-limit", false, "failed"],
  [
    "denial after evidence",
    { afterError: { message: "Permission denied" } },
    "environment-blocked",
    false,
    "incomplete",
  ],
  [
    "provider fault after evidence",
    { afterError: { message: "Quota exhausted" } },
    "rate-limited",
    false,
    "incomplete",
  ],
] as const) {
  test(`failed shutdown retains ${label} without retries or clean completion`, async (t) => {
    const f = queueFixture(t, { maxRetries: 2 });
    f.setPlan({ worker });
    f.launch(
      [
        "review",
        "--scope",
        "worktree",
        "--task",
        "Update source",
        "--aspects",
        "low-value-comments",
        "--wait",
        "1",
      ],
      {
        imports: [
          fileURLToPath(
            new URL("./fixtures/shutdown-fault.mjs", import.meta.url),
          ),
        ],
      },
    );
    await until(
      () => f.events().length === 1,
      "Actual review invocation started",
    );
    if (cancel) {
      await until(
        () => f.lifecycle().some((e) => e.type === "close"),
        "Provider failure reached cleanup",
      );
      assert.equal(f.run(["cancel", f.state().id]).status, 1);
    } else assert.equal(f.finish().status, 1);
    const task = f.state().tasks[0];
    assert.equal(task?.attempts.length, 1);
    assert.equal(task?.attempts[0]?.failure, expected);
    assert.equal(task?.status, status);
    assert.match(
      task?.attempts[0]?.limitations?.join(" ") ?? "",
      /cleanup failed/,
    );
    assert.ok(
      !JSON.stringify(f.state()).includes("private-cleanup-diagnostic"),
    );
    assert.equal(
      task?.result?.status ?? null,
      status === "incomplete" ? "incomplete" : null,
    );
    if (cancel) assert.match(f.run(["report"]).stdout, /stopReason: cancelled/);
  });
}

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
  ["account limit", { message: "Account usage limit reached" }, "rate-limited"],
  ["rate limit", { message: "Rate limit 429" }, "rate-limited"],
  [
    "permission denial",
    { message: "Permission denied" },
    "environment-blocked",
  ],
  ["unrelated author", { message: "Cannot decode author record" }, "runtime"],
  ["unrelated policy", { message: "Cannot decode policy record" }, "runtime"],
  [
    "unrelated 429",
    { message: "Cannot decode record 429 in provider response" },
    "runtime",
  ],
  ["HTTP 429", { message: "HTTP 429: Too Many Requests" }, "rate-limited"],
  ["disabled account", { message: "Account disabled" }, "account-disabled"],
  ["suspended account", { message: "Account suspended" }, "account-disabled"],
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
    "all incomplete zero findings",
    {
      "masked-errors": {
        aspect: "masked-errors",
        status: "incomplete",
        findings: [],
        limitations: ["Callers unavailable."],
      },
      "low-value-comments": {
        ...clean,
        status: "incomplete",
        limitations: ["Callers unavailable."],
      },
    },
    "partial",
  ],
  [
    "incomplete with evidence",
    {
      "low-value-comments": {
        ...clean,
        status: "incomplete",
        findings: [finding],
        limitations: ["Callers unavailable."],
      },
    },
    "partial",
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
      // The budget must still hold a timed-out attempt plus its retry after a
      // slow hosted runner's cold missed-reuse start.
      limits: { workerTimeoutSeconds: 2, runTimeoutSeconds: 8 },
    });
    f.setPlan({
      workers: {
        "missed-reuse": useful ? {} : { hang: true, descendant: true },
        "unnecessary-layers": { hang: true, descendant: true },
        "speculative-flexibility": {},
      },
    });
    const start = Date.now();
    f.start([
      "--aspects",
      "missed-reuse,unnecessary-layers,speculative-flexibility",
    ]);
    const originalDeadline = f.state().deadline;
    const done = f.finish();
    const state = f.state();
    assert.equal(done.status, 1, done.stdout);
    assert.equal(state.status, useful ? "partial" : "failed");
    assert.equal(state.executions?.at(-1)?.stopReason, "deadline");
    assert.equal(state.deadline, originalDeadline);
    // Ten 2-second retries would exceed this if errors reset the run budget.
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
    assert.ok(retrying.attempts.length > 1, "A timed-out attempt was retried");
    assert.ok(retrying.attempts.length <= 1 + maxRetries);
    // The final attempt can race the run deadline; earlier timeouts stay intact.
    assert.ok(
      retrying.attempts.slice(0, -1).every((a) => a.failure === "timeout"),
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

test("runtime passes supported maxTurns and reports unsupported enforcement in the result", (t) => {
  for (const agent of ["claude", "codex", "pi"] as const) {
    const f = queueFixture(t, {
      agent,
      model:
        agent === "claude"
          ? "claude-haiku-4-5-20251001"
          : agent === "pi"
            ? "openai/gpt-6-luna"
            : "gpt-6-luna",
      limits: { maxTurns: 3, workerTimeoutSeconds: 10, runTimeoutSeconds: 20 },
    });
    f.start(["--aspects", "low-value-comments"]);
    assert.equal(f.finish().status, 0);
    const session = f.lifecycle().find((e) => e.type === "session");
    assert.equal(session?.meta?.claudeCode?.options?.maxTurns, 3);
    if (agent !== "claude")
      assert.ok(
        f
          .state()
          .tasks[0]?.limitations.some((l) =>
            /does not natively enforce maxTurns/i.test(l),
          ),
      );
  }
});

test("actual ACP permission requests are denied while valid evidence is retained", (t) => {
  const f = queueFixture(t, { maxRetries: 2 });
  f.setPlan({ worker: { permissionRequest: true } });
  f.start(["--aspects", "low-value-comments"]);
  const done = f.finish();
  assert.equal(done.status, 0, done.stdout);
  assert.deepEqual(
    f.lifecycle().find((e) => e.type === "permission")?.outcome,
    { outcome: "selected", optionId: "deny" },
  );
  assert.equal(f.state().tasks[0]?.attempts.length, 1);
});

test("a valid result followed by an attempt timeout remains useful but unresolved", (t) => {
  const f = queueFixture(t, {
    maxRetries: 2,
    limits: { workerTimeoutSeconds: 2, runTimeoutSeconds: 10 },
  });
  f.setPlan({
    worker: {
      result: { ...clean, status: "findings", findings: [finding] },
      afterHang: true,
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  const done = f.finish();
  assert.equal(done.status, 1, done.stdout);
  assert.equal(f.state().status, "partial");
  const task = f.state().tasks[0];
  assert.ok(task);
  assert.equal(task.status, "incomplete");
  assert.equal(task.result?.findings.length, 1);
  assert.equal(
    task.attempts.length,
    1,
    "Valid incomplete evidence requires explicit resume",
  );
  assert.equal(task.attempts[0]?.failure, "timeout");
});

test("a silent worker stops at the idle limit, long before its hard timeout", (t) => {
  const f = queueFixture(t, {
    maxRetries: 0,
    concurrency: 1,
    limits: {
      workerTimeoutSeconds: 60,
      workerIdleSeconds: 1,
      runTimeoutSeconds: 90,
    },
  });
  f.setPlan({ worker: { hang: true } });
  const started = Date.now();
  f.start(["--aspects", "low-value-comments"]);
  const done = f.finish();
  assert.equal(done.status, 1, done.stdout);
  assert.ok(Date.now() - started < 30_000);
  const [attempt] = f.state().tasks[0]?.attempts ?? [];
  assert.equal(attempt?.failure, "timeout");
  assert.ok(attempt?.lastActivityAt);
  assert.match(done.stdout, /stopped as idle/);
});
