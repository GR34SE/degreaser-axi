import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stopRuns } from "../scripts/stop-runs.ts";
import { alive, queueFixture, until } from "./queue-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);

test("a caller killed after admission leaves an owner that cleanup stops through verified cancel", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("never") } });
  const caller = f.launch([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--aspects",
    "A06",
    "--wait",
    "30",
  ]);
  await until(
    () =>
      existsSync(join(f.root, ".degreaser/state.json")) &&
      f.state().owner !== undefined &&
      f.events().length === 1,
    "Owner admits the worker",
  );
  const exited = once(caller, "exit");
  caller.kill("SIGKILL");
  await exited;
  const owner = f.state().owner?.pid;
  assert.ok(owner && alive(owner));
  assert.deepEqual(await stopRuns(f.root, [cli]), []);
  assert.ok(!alive(owner));
  assert.equal(f.state().status, "failed");
});

test("cleanup never signals an unverified owner and reports the run as unconfirmed", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 1);
  const run = f.state();
  assert.ok(run.owner);
  const original = run.owner;
  await until(() => !alive(original.pid), "Original owner exits");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  const closed = once(sentinel, "close");
  assert.ok(sentinel.pid);
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        ...run,
        status: "running",
        owner: { ...original, pid: sentinel.pid, heartbeat: Date.now() },
      }),
    );
    const bytes = readFileSync(path);
    assert.deepEqual(await stopRuns(f.root, [cli]), [run.id]);
    assert.ok(alive(sentinel.pid));
    assert.deepEqual(readFileSync(path), bytes);
  } finally {
    writeFileSync(path, JSON.stringify(run));
    sentinel.kill("SIGKILL");
    await closed;
  }
});

test("a timed-out cancel leaves the run unconfirmed and its owner running", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("never") } });
  assert.equal(f.start(["--aspects", "A06"]).status, 3);
  const run = f.state();
  assert.ok(run.owner);
  assert.deepEqual(
    await stopRuns(f.root, ["-e", "setTimeout(() => {}, 10000)"], 200),
    [run.id],
  );
  assert.ok(alive(run.owner.pid));
  assert.equal(f.state().status, "running");
});

test("malformed run state and a terminal run with a live recorded owner stay unconfirmed", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 1);
  const run = f.state();
  assert.ok(run.owner);
  const original = run.owner;
  await until(() => !alive(original.pid), "Original owner exits");
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  const closed = once(sentinel, "close");
  assert.ok(sentinel.pid);
  try {
    writeFileSync(path, "{}");
    assert.deepEqual(await stopRuns(f.root, [cli], 2000), [run.id]);
    assert.equal(readFileSync(path, "utf8"), "{}");
    writeFileSync(
      path,
      JSON.stringify({ ...run, owner: { ...original, pid: sentinel.pid } }),
    );
    assert.deepEqual(await stopRuns(f.root, [cli], 2000), [run.id]);
    assert.ok(alive(sentinel.pid));
  } finally {
    writeFileSync(path, JSON.stringify(run));
    sentinel.kill("SIGKILL");
    await closed;
  }
});
