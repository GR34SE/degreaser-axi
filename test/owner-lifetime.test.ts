import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { alive, queueFixture, until } from "./queue-fixture.ts";

function capture(child: ChildProcessWithoutNullStreams) {
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  return once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
}

test("bounded waits and lost waiters retain one detached owner and terminal waits are read-only", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  const started = f.start(["--aspects", "A06"]);
  assert.equal(started.status, 3, started.stdout);
  const { id, owner } = f.state();
  assert.ok(owner);
  const running = (result: { status: number | null; stdout: string }) => {
    assert.equal(result.status, 3, result.stdout);
    assert.match(result.stdout, /status: running/);
    assert.ok(result.stdout.includes(`run: ${id}`));
    assert.ok(result.stdout.includes(`degreaser-axi wait ${id}`));
    assert.ok(!result.stdout.includes("degreaser-axi review"));
  };
  running(started);
  running(f.run(["wait", id, "--wait", "1"]));
  const waiter = f.launch(["wait", id, "--wait", "20"], { detached: true });
  const killed = capture(waiter);
  await setTimeout(400);
  assert.ok(waiter.pid);
  process.kill(-waiter.pid, "SIGKILL");
  assert.equal((await killed).signal, "SIGKILL");
  const timedOut = await capture(
    f.launch(["wait", id, "--wait", "20"], { timeout: 1000 }),
  );
  assert.equal(timedOut.signal, "SIGTERM");
  assert.equal(timedOut.stdout, "");
  assert.equal(f.state().owner?.pid, owner.pid);
  assert.ok(alive(owner.pid));
  assert.equal(f.events().length, 1);
  assert.ok(f.events().every((event) => alive(event.pid)));
  f.release("finish");
  const done = f.finish();
  assert.equal(done.status, 0, done.stdout);
  assert.ok(done.stdout.includes(`run: ${id}`));
  await until(
    () => !alive(owner.pid),
    "The per-run owner exits after completion",
  );
  const file = join(f.root, ".degreaser/runs", id, "run.json");
  const bytes = readFileSync(file);
  for (let i = 0; i < 2; i++)
    assert.equal(f.run(["wait", id, "--wait", "1"]).status, 0);
  assert.deepEqual(readFileSync(file), bytes);
  assert.equal(f.events().length, 1);
  assert.equal(f.state().tasks[0]?.attempts.length, 1);
  assert.ok(!existsSync(join(f.root, ".degreaser/runs", id, "owner.lock")));
});

test("killing the original review caller process group does not kill its owner or worker", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  const caller = f.launch(
    [
      "review",
      "--scope",
      "worktree",
      "--task",
      "Update source",
      "--aspects",
      "A06",
      "--wait",
      "20",
    ],
    { detached: true },
  );
  const result = capture(caller);
  await until(
    () => f.events().length === 1,
    "Original review has admitted its worker",
  );
  const { id, owner } = f.state();
  assert.ok(owner && caller.pid);
  process.kill(-caller.pid, "SIGKILL");
  const killed = await result;
  assert.equal(killed.signal, "SIGKILL");
  assert.ok(killed.stderr.includes(`run: ${id}`));
  assert.equal(killed.stdout, "");
  assert.ok(alive(owner.pid));
  assert.ok(f.events().every((event) => alive(event.pid)));
  f.release("finish");
  assert.equal(f.finish().status, 0);
  assert.equal(f.state().owner?.pid, owner.pid);
  assert.equal(f.events().length, 1);
  await until(
    () => !alive(owner.pid),
    "Owner exits without the original caller",
  );
});

for (const useful of [false, true]) {
  test(`public cancel joins only its locked run with ${useful ? "useful" : "no useful"} results`, async (t) => {
    const sentinel = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { stdio: "ignore" },
    );
    const sentinelExit = once(sentinel, "exit");
    t.after(async () => {
      sentinel.kill();
      await sentinelExit;
    });
    const other = queueFixture(t);
    other.setPlan({ worker: { resultGate: other.gate("finish") } });
    assert.equal(other.start(["--aspects", "A06"]).status, 3);
    const otherOwner = other.state().owner;
    assert.ok(otherOwner);
    const f = queueFixture(t, { concurrency: 1, maxRetries: 3 });
    f.setPlan({
      workers: {
        A01: useful
          ? {}
          : { attempts: [{ result: "" }, { descendant: true, hang: true }] },
        A02: { descendant: true, hang: true },
      },
    });
    f.start(["--aspects", "A01,A02,A03"]);
    await until(
      () => f.lifecycle().some((event) => event.childPid),
      "Owned descendant is active",
    );
    const before = f.state(),
      owner = before.owner;
    assert.ok(owner);
    assert.ok(
      existsSync(join(f.root, ".degreaser/runs", before.id, "owner.lock")),
    );
    const cancelled = f.run(["cancel", before.id]);
    assert.equal(cancelled.status, 1, cancelled.stdout);
    assert.match(
      cancelled.stdout,
      new RegExp(`status: ${useful ? "partial" : "failed"}`),
    );
    assert.match(cancelled.stdout, /cancelled/);
    assert.doesNotMatch(cancelled.stdout, /run-busy/);
    const after = f.state();
    assert.equal(after.status, useful ? "partial" : "failed");
    assert.deepEqual(
      after.tasks.map((task) => task.attempts.length),
      useful ? [1, 1, 0] : [2, 0, 0],
    );
    if (useful) assert.deepEqual(after.tasks[0], before.tasks[0]);
    else assert.equal(after.tasks[0]?.attempts[0]?.failure, "invalid-output");
    assert.equal(
      after.tasks[useful ? 1 : 0]?.attempts.at(-1)?.failure,
      "cancelled",
    );
    await until(() => !alive(owner.pid), "Cancelled owner exits");
    for (const event of f.lifecycle()) {
      assert.ok(!alive(event.pid));
      if (event.childPid) assert.ok(!alive(event.childPid));
    }
    assert.ok(sentinel.pid && alive(sentinel.pid));
    assert.ok(alive(otherOwner.pid));
    assert.ok(other.events().every((event) => alive(event.pid)));
    assert.equal(other.events().length, 1);
    assert.equal(f.run(["report", before.id, "--full"]).status, 1);
    assert.deepEqual(f.state(), after);
    other.release("finish");
    assert.equal(other.finish().status, 0);
  });
}

test("completion racing cancel never loses evidence, duplicates attempts or leaves workers", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  f.start(["--aspects", "A06"]);
  const { id, owner } = f.state();
  assert.ok(owner);
  const cancellation = capture(f.launch(["cancel", id]));
  f.release("finish");
  const response = await cancellation;
  assert.ok(response.code === 0 || response.code === 1, response.stdout);
  assert.doesNotMatch(response.stdout, /run-busy/);
  await until(() => !alive(owner.pid), "Raced owner exits");
  const state = f.state();
  assert.equal(state.tasks[0]?.attempts.length, 1);
  assert.equal(f.events().length, 1);
  const bytes = readFileSync(join(f.root, ".degreaser/runs", id, "run.json"));
  const again = f.run(["cancel", id]);
  assert.equal(again.status, response.code);
  assert.deepEqual(
    readFileSync(join(f.root, ".degreaser/runs", id, "run.json")),
    bytes,
  );
  assert.equal(f.run(["wait", id]).status, response.code);
});

test("cancel after completion is a read-only completed no-op", async (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  const { id, owner } = f.state();
  assert.ok(owner);
  await until(() => !alive(owner.pid), "Completed owner exits");
  const before = f.state();
  const result = f.run(["cancel", id]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /status: completed/);
  assert.deepEqual(f.state(), before);
  assert.equal(f.events().length, 1);
});

test("cancel before invocation stops cold admission without retries", async (t) => {
  const f = queueFixture(t, { maxRetries: 3 });
  f.setPlan({ worker: { initializeGate: f.gate("never") } });
  f.start(["--aspects", "A01,A02,A03"]);
  await until(
    () => f.lifecycle().some((event) => event.type === "initialize"),
    "Worker is starting",
  );
  const id = f.state().id;
  const response = f.run(["cancel", id]);
  assert.equal(response.status, 1, response.stdout);
  const state = f.state();
  assert.equal(state.status, "failed");
  assert.deepEqual(
    state.tasks.map((task) => task.attempts.length),
    [1, 0, 0],
  );
  assert.ok(state.tasks.every((task) => task.status === "cancelled"));
  assert.deepEqual(f.events(), []);
});

test("cancel retains evidence received before a worker finishes", async (t) => {
  const f = queueFixture(t, { maxRetries: 3 });
  f.setPlan({
    worker: {
      afterHang: true,
      result: {
        aspect: "A06",
        status: "findings",
        limitations: [],
        findings: [
          {
            location: {
              path: "source.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
            },
            quote: "// redundant",
            title: "Redundant explanation",
            evidence: "Comment repeats the declaration.",
            consequence: "Extra maintenance.",
            countercheck: "No separate rationale.",
            recommendation: "Remove the comment.",
          },
        ],
      },
    },
  });
  f.start(["--aspects", "A06"]);
  await until(
    () => f.lifecycle().some((event) => event.type === "output"),
    "Evidence was sent before cancellation",
  );
  const response = f.run(["cancel", f.state().id]);
  assert.equal(response.status, 1, response.stdout);
  assert.equal(f.state().status, "partial");
  const task = f.state().tasks[0];
  assert.equal(task?.status, "incomplete");
  assert.equal(task?.result?.findings[0]?.quote, "// redundant");
  assert.equal(task?.attempts.length, 1);
  assert.equal(task?.attempts[0]?.failure, "cancelled");
  assert.match(f.run(["report", "--full"]).stdout, /Redundant explanation/);
});

test("cancel refuses an unrelated live PID instead of trusting persisted ownership", async (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  const before = f.state();
  const owner = before.owner;
  assert.ok(owner);
  await until(() => !alive(owner.pid), "Original owner exits");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  const sentinelExit = once(sentinel, "exit");
  assert.ok(sentinel.pid);
  const file = `.degreaser/runs/${before.id}/run.json`;
  const changed = JSON.stringify({
    ...before,
    status: "running",
    owner: { pid: sentinel.pid, heartbeat: Date.now() },
  });
  f.write(file, changed);
  try {
    const response = f.run(["cancel", before.id]);
    assert.equal(response.status, 2, response.stdout);
    assert.match(response.stdout, /owner-unverified/);
    assert.ok(alive(sentinel.pid));
    assert.equal(readFileSync(join(f.root, file), "utf8"), changed);
    assert.equal(f.events().length, 1);
  } finally {
    f.write(file, JSON.stringify(before));
    sentinel.kill();
    await sentinelExit;
  }
});

test("cancelling an explicit earlier run does not signal the latest owner in the same repository", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { descendant: true, hang: true } });
  f.start(["--aspects", "A01"]);
  await until(
    () => f.lifecycle().some((event) => event.childPid),
    "First run owns a descendant",
  );
  const first = f.state();
  f.setPlan({ worker: { resultGate: f.gate("finish-second") } });
  assert.equal(f.start(["--aspects", "A06"]).status, 3);
  const second = f.state(),
    secondOwner = second.owner;
  assert.ok(secondOwner);
  assert.notEqual(second.id, first.id);
  const response = f.run(["cancel", first.id]);
  assert.equal(response.status, 1, response.stdout);
  assert.ok(response.stdout.includes(`run: ${first.id}`));
  assert.equal(f.state(first.id).status, "failed");
  assert.equal(f.state().id, second.id);
  assert.equal(f.state().status, "running");
  assert.ok(alive(secondOwner.pid));
  assert.equal(f.run(["wait", second.id, "--wait", "1"]).status, 3);
  f.release("finish-second");
  assert.equal(f.finish().status, 0);
  assert.equal(f.state().owner?.pid, secondOwner.pid);
  assert.deepEqual(
    f.events().map((event) => event.aspect),
    ["A01", "A06"],
  );
});
