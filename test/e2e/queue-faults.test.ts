import assert from "node:assert/strict";

import test from "node:test";

import { fileURLToPath } from "node:url";

import { queueFixture, until } from "../utils/queue-fixture.ts";

import { atLimit, clean, finding, oversized } from "../utils/queue-results.ts";

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
          (name.includes("timeout")
            ? e.prompt === calls[0]?.prompt
            : e.prompt?.startsWith(calls[0]?.prompt ?? "")) &&
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
            new URL("../fixtures/shutdown-fault.mjs", import.meta.url),
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

test("runtime passes supported maxTurns and reports unsupported enforcement in the result", (t) => {
  for (const agent of ["claude", "codex", "pi", "cursor"] as const) {
    const f = queueFixture(t, {
      agent,
      model:
        agent === "claude"
          ? "claude-haiku-4-5-20251001"
          : agent === "pi"
            ? "openai/gpt-6-luna"
            : agent === "cursor"
              ? "composer-2.5-fast"
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
