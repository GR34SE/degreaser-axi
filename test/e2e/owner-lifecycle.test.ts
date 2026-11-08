import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

const psFault = fileURLToPath(
  new URL("../fixtures/ps-fault.mjs", import.meta.url),
);
const incomplete = (aspect: string) => ({
  aspect,
  status: "incomplete",
  findings: [],
  limitations: ["Turn budget used."],
  examinedPaths: [],
});

test("a terminal owner record keeps no exited process identities, so recycled PIDs cannot block resume", async (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      "low-value-comments": { result: incomplete("low-value-comments") },
    },
  });
  f.start(["--aspects", "masked-errors,low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  assert.equal(old.status, "partial");
  assert.ok(old.owner);
  const owner = old.owner;
  assert.deepEqual(owner.processes ?? [], []);
  await until(() => !alive(owner.pid), "Owner exits");
  f.setPlan({});
  assert.equal(f.run(["resume", old.id, "--wait", "20"]).status, 0);
});

test("a recycled owner PID does not block resume of a terminal run", async (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      "low-value-comments": { result: incomplete("low-value-comments") },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  const owner = old.owner;
  assert.ok(owner);
  await until(() => !alive(owner.pid), "Owner exits");
  const stranger = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
  const exited = once(stranger, "exit");
  t.after(async () => {
    stranger.kill("SIGKILL");
    await exited;
  });
  assert.ok(stranger.pid);
  const path = join(f.root, ".degreaser/runs", old.id, "run.json");
  const forged = JSON.parse(readFileSync(path, "utf8"));
  forged.owner.pid = stranger.pid;
  writeFileSync(path, JSON.stringify(forged));
  f.setPlan({});
  assert.equal(f.run(["resume", old.id, "--wait", "20"]).status, 0);
  assert.ok(alive(stranger.pid), "The unrelated process is never signalled");
});

test("a failing process inspection during heartbeats does not strand the run", async (t) => {
  const f = queueFixture(t);
  const marker = f.gate("ps-fault");
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  const first = f.launch(
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
    { imports: [psFault], env: { SYNTHETIC_PS_FAULT: marker } },
  );
  await once(first, "exit");
  const before = f.state();
  assert.ok(before.owner);
  const beat = before.owner.heartbeat;
  f.release("ps-fault");
  await until(
    () => (f.state().owner?.heartbeat ?? 0) > beat,
    "Heartbeat keeps recording while ps fails",
  );
  assert.equal(f.state().status, "running");
  f.release("finish");
  assert.equal(f.finish().status, 0);
  assert.equal(f.state().status, "completed");
});

test("a failing process inspection at worker lifecycle stops admission and records the cause", async (t) => {
  const f = queueFixture(t);
  const marker = f.gate("ps-fault");
  f.setPlan({
    workers: { "masked-errors": { resultGate: f.gate("finish") } },
  });
  const first = f.launch(
    [
      "review",
      "--scope",
      "worktree",
      "--task",
      "Update source",
      "--aspects",
      "masked-errors,low-value-comments",
      "--concurrency",
      "1",
      "--wait",
      "1",
    ],
    { imports: [psFault], env: { SYNTHETIC_PS_FAULT: marker } },
  );
  await once(first, "exit");
  await until(() => f.events().length === 1, "First worker prompt starts");
  f.release("ps-fault");
  f.release("finish");
  assert.equal(f.finish().status, 1);
  const run = f.state();
  assert.equal(run.executions?.at(-1)?.failure?.code, "owner-unverified");
  assert.equal(f.events().length, 1, "No further worker is launched");
  assert.notEqual(run.status, "completed");
});

test("a repository audit where every worker fails is failed, not partial", (t) => {
  const f = queueFixture(t);
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Add source");
  f.setPlan({ permissionDeniedBefore: true });
  f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Audit",
    "--aspects",
    "scope-creep,masked-errors",
    "--wait",
    "20",
  ]);
  const run = f.state();
  assert.ok(run.tasks.some((task) => task.status === "not-applicable"));
  assert.equal(run.status, "failed");
});

test("cancel of an interrupted run stops verified orphan workers and starts nothing", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { hang: true, descendant: true } });
  f.start(["--aspects", "low-value-comments"]);
  await until(
    () => f.lifecycle().some((e) => e.type === "descendant"),
    "Worker owns a descendant",
  );
  const old = f.state();
  const owner = old.owner;
  assert.ok(owner);
  t.after(() => {
    try {
      process.kill(-owner.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  });
  await until(
    () => (f.state().owner?.heartbeat ?? 0) > owner.heartbeat,
    "Heartbeat records the worker tree",
  );
  const workers = f
    .lifecycle()
    .flatMap((e) => [e.pid, ...(e.childPid ? [e.childPid] : [])]);
  process.kill(owner.pid, "SIGKILL");
  await until(() => !alive(owner.pid), "Owner is dead");
  assert.ok(workers.some(alive), "Orphaned workers survive their owner");
  const cancelled = f.run(["cancel", old.id]);
  assert.equal(cancelled.status, 1, cancelled.stdout + cancelled.stderr);
  await until(() => workers.every((pid) => !alive(pid)), "Workers stopped");
  assert.equal(f.events().length, 1);
});

test("an earlier attempt forced incomplete by cleanup does not make scope-creep applicable", async (t) => {
  const f = queueFixture(t, { agent: "pi", model: "openai/gpt-6-luna" });
  f.setPlan({
    workers: {
      "scope-creep": {
        closeError: { message: "Synthetic close failure", code: -32603 },
        result: incomplete("scope-creep"),
      },
    },
  });
  f.start(["--aspects", "scope-creep"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  assert.equal(old.tasks[0]?.attempts[0]?.failure, "cleanup");
  const owner = old.owner;
  if (owner) await until(() => !alive(owner.pid), "Owner exits");
  f.setPlan({
    workers: {
      "scope-creep": {
        result: {
          ...incomplete("scope-creep"),
          status: "not-applicable",
          limitations: [],
          reason: "No feature scope.",
        },
      },
    },
  });
  assert.equal(f.run(["resume", old.id, "--wait", "20"]).status, 0);
  assert.equal(f.state().tasks[0]?.status, "not-applicable");
});
