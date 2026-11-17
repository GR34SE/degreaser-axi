import assert from "node:assert/strict";
import test from "node:test";
import { waitFor } from "../../src/cli/commands/shared/run.ts";
import { createFactory } from "../../src/cli/factory.ts";
import { alive, capture, queueFixture, until } from "../utils/queue-fixture.ts";

test("wait reports the persisted result when the owner finishes after the running snapshot", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("release-result") } });
  const started = f.run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--aspects",
    "low-value-comments",
    "--wait",
    "1",
  ]);
  assert.equal(started.status, 3, started.stdout + started.stderr);
  await until(() => f.events().length === 1, "Synthetic result is gated");
  const snapshot = f.state();
  assert.equal(snapshot.status, "running");
  const owner = snapshot.owner;
  assert.ok(owner);

  f.release("release-result");
  await until(() => f.state().status === "completed", "Owner persisted");
  await until(() => !alive(owner.pid), "Completed owner exited");

  const result = await waitFor(createFactory(), snapshot, 10);
  assert.equal(result.status, f.state().status);
  assert.equal(result.status, "completed");
});

test("waiting emits a thirty-second heartbeat and reports each completed aspect on stderr", async (t) => {
  const { Writable } = await import("node:stream");
  let cleanup = async () => {};
  t.after(() => cleanup());
  const f = queueFixture(t, {
    limits: { workerTimeoutSeconds: 90, runTimeoutSeconds: 120 },
  });
  f.setPlan({
    worker: { resultGate: f.gate("last") },
    workers: { "masked-errors": { resultGate: f.gate("first") } },
  });
  f.start(["--aspects", "masked-errors,low-value-comments"]);
  await until(() => f.events().length === 2, "Both aspect sessions are gated");
  let clock = Date.now();
  let stderr = "";
  const runtime = createFactory();
  const io = {
    ...runtime.io,
    error: new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk;
        callback();
      },
    }),
  };
  const waiting = waitFor(
    createFactory({ now: () => clock, io }),
    f.state(),
    null,
  );
  cleanup = async () => {
    f.release("first");
    f.release("last");
    await waiting;
  };
  clock += 30_000;
  await until(
    () => stderr.length > 0,
    "The thirty-second heartbeat is written",
  );
  assert.match(
    stderr,
    /aspects: 0\/2; candidates: 0; verdicts: 0; elapsed: 3\ds/,
  );
  f.release("first");
  await until(
    () => stderr.includes("masked-errors (no-findings)"),
    "Completed peer is reported while the other worker remains gated",
  );
  f.release("last");
  const result = await waiting;
  assert.equal(result.status, "completed");
  assert.match(stderr, /low-value-comments \(no-findings\)/);
  assert.match(stderr, /aspects: 2\/2/);
});

test("resume reports each rerun aspect when it finishes and counts only the aspects finished by then", async (t) => {
  const f = queueFixture(t, {
    limits: { workerTimeoutSeconds: 15, runTimeoutSeconds: 60 },
  });
  const rerun = ["masked-errors", "low-value-comments"];
  const plan = (worker: (aspect: string) => object) =>
    f.setPlan({
      workers: Object.fromEntries(
        rerun.map((aspect) => [aspect, worker(aspect)]),
      ),
    });
  plan(() => ({ result: "" }));
  f.start(["--aspects", ["missed-reuse", ...rerun].join(",")]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  assert.deepEqual(
    Object.fromEntries(
      old.tasks.map((task) => [task.assignment.aspect, task.status]),
    ),
    {
      "missed-reuse": "no-findings",
      "masked-errors": "failed",
      "low-value-comments": "failed",
    },
  );
  plan((aspect) => ({ resultGate: f.gate(aspect) }));
  const before = f.events().length;
  const caller = f.launch(["resume", old.id, "--concurrency", "1"]);
  let stderr = "";
  caller.stderr.on("data", (data) => {
    stderr += data;
  });
  const resumed = capture(caller);
  await until(
    () => f.events().length === before + 1,
    "One rerun finder holds the only slot",
  );
  const first = f.events()[before]?.aspect;
  const second = rerun.find((aspect) => aspect !== first);
  assert.ok(first && second);
  f.release(first);
  await until(
    () => stderr.includes(`aspect: ${first} (no-findings)`),
    "The first rerun aspect is reported when it finishes",
  );
  assert.match(stderr, new RegExp(`aspects: 2/3; [^\\n]*aspect: ${first} `));
  f.release(second);
  const result = await resumed;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    new RegExp(`aspects: 3/3; [^\\n]*aspect: ${second} \\(no-findings\\)`),
  );
});
