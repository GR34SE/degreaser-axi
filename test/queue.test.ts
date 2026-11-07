import assert from "node:assert/strict";
import test from "node:test";
import { ASPECT_IDS } from "../src/config.ts";
import { alive, queueFixture, until } from "./queue-fixture.ts";

const all = [...ASPECT_IDS].sort();

test("default fleet holds at session readiness, then sixteen real workers overlap before any result", async (t) => {
  const f = queueFixture(t);
  f.setPlan({
    worker: { invocationGate: f.gate("invoke"), resultGate: f.gate("result") },
  });
  assert.equal(f.start().status, 3);
  await until(
    () => f.lifecycle().some((e) => e.type === "set-model"),
    "First session reached model selection",
  );
  assert.equal(f.lifecycle().filter((e) => e.type === "initialize").length, 1);
  assert.equal(f.events().length, 0);
  f.release("invoke");
  await until(
    () => f.events().length === 16,
    "All sixteen prompts must start without a hidden cap",
  );
  assert.deepEqual(
    f
      .events()
      .map((e) => e.aspect)
      .sort(),
    all,
  );
  assert.equal(f.events()[0]?.aspect, "missed-reuse");
  assert.ok(f.events().every((e) => alive(e.pid)));
  assert.ok(f.state().tasks.every((task) => task.status === "running"));
  f.release("result");
  const done = f.finish();
  assert.equal(done.status, 0, done.stdout);
  assert.match(done.stdout, /aspects: 16\/16/);
});

for (const cap of [1, 2, 20]) {
  test(`cap ${cap} refills joined slots and launches only the selected aspects`, async (t) => {
    const f = queueFixture(t, { concurrency: cap });
    f.setPlan({
      workers: Object.fromEntries(
        ["masked-errors", "low-value-comments", "contract-bypass"].map((id) => [
          id,
          { resultGate: f.gate(id) },
        ]),
      ),
    });
    assert.equal(
      f.start(["--aspects", "masked-errors,low-value-comments,contract-bypass"])
        .status,
      3,
    );
    const slots = Math.min(cap, 3);
    await until(() => f.events().length === slots, "Initial slots fill");
    assert.equal(
      f.state().tasks.filter((task) => task.attempts.length).length,
      slots,
    );
    for (const [index, id] of [
      "masked-errors",
      "low-value-comments",
      "contract-bypass",
    ].entries()) {
      await until(
        () => f.events().some((e) => e.aspect === id),
        `${id} admitted`,
      );
      assert.ok(f.events().filter((e) => alive(e.pid)).length <= cap);
      f.release(id);
      await until(
        () => f.state().tasks[index]?.status === "no-findings",
        `${id} completed`,
      );
    }
    assert.equal(f.finish().status, 0);
    assert.deepEqual(
      f
        .events()
        .map((e) => e.aspect)
        .sort(),
      ["contract-bypass", "low-value-comments", "masked-errors"],
    );
    for (const task of f.state().tasks) assert.equal(task.attempts.length, 1);
  });
}

test("a pre-invocation failure does not release the whole cold fleet", async (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      "missed-reuse": { startupError: { message: "Authentication required" } },
      "unnecessary-layers": {
        invocationGate: f.gate("invoke"),
        resultGate: f.gate("result"),
      },
      "speculative-flexibility": { resultGate: f.gate("result") },
    },
  });
  assert.equal(
    f.start([
      "--aspects",
      "missed-reuse,unnecessary-layers,speculative-flexibility",
    ]).status,
    3,
  );
  await until(
    () =>
      f
        .lifecycle()
        .some(
          (e) => e.aspect === "unnecessary-layers" && e.type === "set-model",
        ),
    "Second worker warms after first failure",
  );
  assert.equal(f.lifecycle().filter((e) => e.type === "initialize").length, 2);
  assert.equal(f.events().length, 0, "No worker bypasses the warmup gate");
  f.release("invoke");
  f.release("result");
  assert.equal(f.finish().status, 1);
  assert.equal(f.state().status, "partial");
});

test("all pre-invocation failures terminate within the watchdog with no prompt or retries", (t) => {
  const f = queueFixture(t, { maxRetries: 2 });
  f.setPlan({
    worker: { startupError: { message: "Authentication required" } },
  });
  f.start([
    "--aspects",
    "missed-reuse,unnecessary-layers,speculative-flexibility",
  ]);
  assert.equal(f.finish().status, 1);
  assert.equal(f.state().status, "failed");
  assert.equal(f.events().length, 0);
  assert.ok(f.state().tasks.every((task) => task.attempts.length === 1));
});

test("whole attempt budget includes profile startup before adapter dispatch", (t) => {
  const f = queueFixture(t, {
    limits: { workerTimeoutSeconds: 1, runTimeoutSeconds: 10 },
  });
  f.setPlan({ profileDelayMs: 1800 });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 1);
  assert.equal(f.events().length, 0);
  assert.equal(f.state().tasks[0]?.attempts[0]?.failure, "timeout");
});

test("retries retain their cap slot and join the prior process before a fresh session", async (t) => {
  const f = queueFixture(t, { concurrency: 2, maxRetries: 1 });
  f.setPlan({
    workers: {
      "missed-reuse": {
        attempts: [{ result: "" }, { resultGate: f.gate("retry") }],
      },
      "unnecessary-layers": { resultGate: f.gate("peer") },
    },
  });
  assert.equal(
    f.start([
      "--aspects",
      "missed-reuse,unnecessary-layers,speculative-flexibility",
    ]).status,
    3,
  );
  await until(
    () => f.events().filter((e) => e.aspect === "missed-reuse").length === 2,
    "Fresh retry admitted",
  );
  const [first, retry] = f.events().filter((e) => e.aspect === "missed-reuse");
  assert.ok(first && retry);
  assert.notEqual(first.sessionId, retry.sessionId);
  assert.ok(first.prompt && retry.prompt?.startsWith(first.prompt));
  assert.match(retry.prompt ?? "", /previous final result block was rejected/);
  assert.ok(!alive(first.pid), "Prior process is gone before its retry");
  assert.ok(alive(retry.pid));
  assert.equal(f.events().filter((e) => alive(e.pid)).length, 2);
  assert.ok(
    !f.events().some((e) => e.aspect === "speculative-flexibility"),
    "Retry did not free a third slot",
  );
  f.release("retry");
  await until(
    () => f.events().some((e) => e.aspect === "speculative-flexibility"),
    "Completed retry refills the slot",
  );
  assert.equal(
    f.state().tasks[1]?.status,
    "running",
    "Blocked peer is still active",
  );
  f.release("peer");
  assert.equal(f.finish().status, 0);
  assert.deepEqual(
    f.state().tasks[0]?.attempts.map((a) => a.failure),
    ["invalid-output", null],
  );
});
