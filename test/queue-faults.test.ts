import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { alive, queueFixture, until } from "./queue-fixture.ts";

const clean = {
  aspect: "A06",
  status: "no-findings",
  findings: [],
  limitations: [],
};
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
    f.start(["--aspects", "A06"]);
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
] as const) {
  test(`${name} is classified without retries, identity fallback or lost peers`, (t) => {
    const f = queueFixture(t, { maxRetries: 3, concurrency: 2 });
    f.setPlan({ workers: { A06: { error } } });
    f.start(["--aspects", "A04,A06"]);
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
    f.start(["--aspects", "A06"]);
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
      A04: {
        aspect: "A04",
        status: "not-applicable",
        findings: [],
        limitations: [],
        reason: "No error handling.",
      },
      A06: {
        ...clean,
        status: "not-applicable",
        reason: "No explanatory comments.",
      },
    },
    "completed",
  ],
  [
    "with findings",
    { A06: { ...clean, status: "findings", findings: [finding] } },
    "completed",
  ],
  [
    "all incomplete zero findings",
    {
      A04: {
        aspect: "A04",
        status: "incomplete",
        findings: [],
        limitations: ["Callers unavailable."],
      },
      A06: {
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
      A06: {
        ...clean,
        status: "incomplete",
        findings: [finding],
        limitations: ["Callers unavailable."],
      },
    },
    "partial",
  ],
  ["useful plus malformed", { A06: "" }, "partial"],
  ["all malformed", { A04: "", A06: "" }, "failed"],
  ["wrong aspect", { A04: clean, A06: { ...clean, aspect: "A04" } }, "failed"],
] as const) {
  test(`terminal matrix: ${label}`, (t) => {
    const f = queueFixture(t);
    f.setPlan({ results });
    f.start(["--aspects", "A04,A06"]);
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
    const f = queueFixture(t, {
      concurrency: 1,
      maxRetries: 10,
      limits: { workerTimeoutSeconds: 2, runTimeoutSeconds: 6 },
    });
    f.setPlan({
      workers: {
        A01: useful ? {} : { hang: true, descendant: true },
        A02: { hang: true, descendant: true },
        A03: {},
      },
    });
    const start = Date.now();
    f.start(["--aspects", "A01,A02,A03"]);
    const originalDeadline = f.state().deadline;
    const done = f.finish();
    const state = f.state();
    assert.equal(done.status, 1, done.stdout);
    assert.equal(state.status, useful ? "partial" : "failed");
    assert.equal(state.deadline, originalDeadline);
    assert.ok(Date.now() - start < 12000, "Errors cannot reset the run budget");
    const unfinished = state.tasks.filter(
      (task) => task.status !== "no-findings",
    );
    assert.ok(unfinished.every((task) => task.status === "cancelled"));
    assert.ok(
      unfinished.every((task) =>
        task.limitations.some((l) => l.includes("deadline")),
      ),
    );
    assert.ok(
      state.tasks
        .flatMap((task) => task.attempts)
        .some((a) => a.failure === "deadline"),
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
    f.start(["--aspects", "A06"]);
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
  f.start(["--aspects", "A06"]);
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
  f.start(["--aspects", "A06"]);
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
