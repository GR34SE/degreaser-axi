import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareReview } from "../src/input.ts";
import { createRun } from "../src/storage.ts";
import { alive, queueFixture, until } from "./queue-fixture.ts";

function processFixture(
  t: TestContext,
  f: ReturnType<typeof queueFixture>,
  mode: string,
) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./fixtures/public-runtime.mjs", import.meta.url)),
      "--import",
      fileURLToPath(new URL("./fixtures/storage-fault.mjs", import.meta.url)),
      fileURLToPath(new URL("./fixtures/storage-process.mjs", import.meta.url)),
      mode,
      f.root,
      f.state().id,
    ],
    {
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        SYNTHETIC_PLAN: f.gate("plan.json"),
        SYNTHETIC_STORAGE_FAULT: f.gate("fault.json"),
      },
    },
  );
  let stdout = "",
    stderr = "";
  assert.ok(child.stdout && child.stderr);
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const done = once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await done;
  });
  return { child, done };
}

test("killing the actual writer before rename preserves committed successes/history; release publishes a complete record", async (t) => {
  const f = queueFixture(t, { maxRetries: 1 });
  f.setPlan({ workers: { A06: { attempts: [{ result: "" }, {}] } } });
  f.start(["--aspects", "A04,A06"]);
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  const previous = readFileSync(path, "utf8");
  const marker = f.gate("before-rename.json");
  const release = f.gate("rename");
  writeFileSync(
    f.gate("fault.json"),
    JSON.stringify({ mode: "pause", marker, release }),
  );
  const first = processFixture(t, f, "write");
  await until(
    () => existsSync(marker),
    "Real writer reaches rename after writing the temporary record",
  );
  const boundary = JSON.parse(readFileSync(marker, "utf8"));
  assert.equal(boundary.previous, previous);
  assert.deepEqual(JSON.parse(boundary.proposed), {
    ...run,
    deadline: run.deadline + 1000,
  });
  assert.equal(readFileSync(path, "utf8"), previous);
  first.child.kill("SIGKILL");
  assert.equal((await first.done).signal, "SIGKILL");
  assert.equal(readFileSync(path, "utf8"), previous);
  assert.equal(f.run(["report", run.id]).status, 0);
  assert.deepEqual(f.state().tasks, run.tasks);

  const secondMarker = f.gate("second-rename.json");
  writeFileSync(
    f.gate("fault.json"),
    JSON.stringify({ mode: "pause", marker: secondMarker, release }),
  );
  const second = processFixture(t, f, "write");
  await until(() => existsSync(secondMarker), "Second writer reaches rename");
  f.release("rename");
  const done = await second.done;
  assert.equal(done.code, 0, done.stdout + done.stderr);
  assert.deepEqual(f.state(), { ...run, deadline: run.deadline + 1000 });
  assert.equal(f.run(["report", run.id]).status, 0);
});

test("an independent schema-validating process observes concurrent owner transitions without torn or lost records", async (t) => {
  const f = queueFixture(t, { maxRetries: 1 });
  f.setPlan({
    worker: { resultGate: f.gate("results") },
    workers: {
      A06: { attempts: [{ result: "" }, {}], resultGate: f.gate("results") },
    },
  });
  assert.equal(f.start().status, 3);
  await until(() => f.events().length === 16, "Sixteen workers overlap");
  const reader = processFixture(t, f, "reader");
  await Promise.race([
    once(reader.child, "message"),
    reader.done.then((done) =>
      assert.fail(
        `Reader exited before readiness: ${done.stdout}${done.stderr}`,
      ),
    ),
  ]);
  f.release("results");
  const done = await reader.done;
  assert.equal(done.code, 0, done.stdout + done.stderr);
  const observed = JSON.parse(done.stdout);
  assert.ok(observed.reads > 1);
  assert.deepEqual(observed.statuses, ["running", "completed"]);
  assert.equal(f.finish().status, 0);
});

test("the real owner rejects damaged input before writing a heartbeat or starting any attempt", async (t) => {
  const f = queueFixture(t);
  const run = createRun(
    prepareReview(
      ["--scope", "worktree", "--task", "Update", "--aspects", "A06"],
      f.root,
    ),
  );
  const directory = join(f.root, ".degreaser/runs", run.id);
  const path = join(directory, "input/review.json");
  const original = readFileSync(path);
  const previous = readFileSync(join(directory, "run.json"));
  try {
    writeFileSync(path, "{");
    const owner = processFixture(t, f, "owner");
    const done = await owner.done;
    assert.equal(done.code, 1, done.stdout + done.stderr);
    const error = JSON.parse(done.stdout);
    assert.equal(error.code, "state-corrupt");
    assert.ok(error.message.includes(path), done.stdout);
    assert.equal(readFileSync(path, "utf8"), "{");
    assert.deepEqual(readFileSync(join(directory, "run.json")), previous);
    assert.deepEqual(f.events(), []);
  } finally {
    writeFileSync(path, original);
  }
});

for (const [mode, code] of [
  ["prompt-mismatch", "input-changed"],
  ["prompt-error", "owner-failed"],
] as const) {
  test(`${mode} preserves committed peers and is not mislabeled as a storage heartbeat failure`, async (t) => {
    const f = queueFixture(t, { concurrency: 1 });
    createRun(
      prepareReview(
        ["--scope", "worktree", "--task", "Update", "--aspects", "A04,A06"],
        f.root,
      ),
    );
    writeFileSync(f.gate("fault.json"), JSON.stringify({ mode }));
    const owner = processFixture(t, f, "owner");
    const done = await owner.done;
    assert.equal(done.code, 1, done.stdout + done.stderr);
    const error = JSON.parse(done.stdout);
    assert.equal(error.code, code, done.stdout);
    assert.doesNotMatch(done.stdout, /heartbeat|SECRET-canary/i);
    if (mode === "prompt-mismatch") assert.match(error.message, /run\.json/);
    const state = f.state();
    assert.equal(state.tasks[0]?.status, "no-findings");
    assert.equal(state.tasks[0]?.attempts.length, 1);
    assert.ok(state.tasks[0]?.attempts[0]?.endedAt);
    assert.equal(state.tasks[1]?.status, "cancelled");
    assert.deepEqual(state.tasks[1]?.attempts, []);
    assert.equal(f.events().length, 1);
    const report = f.run(["report", state.id]);
    assert.equal(report.status, 1, report.stdout);
    assert.match(report.stdout, /status: partial/);
    assert.match(report.stdout, new RegExp(code));
  });
}

test("one heartbeat replacement failure stops later writes, names run.json and preserves the last committed peer/history", async (t) => {
  const f = queueFixture(t, { concurrency: 1 });
  f.setPlan({ workers: { A06: { resultGate: f.gate("blocked") } } });
  createRun(
    prepareReview(
      ["--scope", "worktree", "--task", "Update", "--aspects", "A04,A06"],
      f.root,
    ),
  );
  const owner = processFixture(t, f, "owner");
  await until(
    () => f.events().some((e) => e.aspect === "A06"),
    "Peer committed and next attempt started",
  );
  const path = join(f.root, ".degreaser/runs", f.state().id, "run.json");
  const marker = f.gate("failed-write.json");
  writeFileSync(
    f.gate("fault.json"),
    JSON.stringify({ mode: "write-failure", marker }),
  );
  const done = await owner.done;
  assert.equal(done.code, 1, done.stdout + done.stderr);
  const error = JSON.parse(done.stdout);
  assert.equal(error.code, "state-write-failed", done.stdout);
  assert.ok(error.message.includes(path), done.stdout);
  assert.doesNotMatch(done.stdout, /SECRET-canary/);
  const boundary = JSON.parse(readFileSync(marker, "utf8"));
  assert.equal(readFileSync(path, "utf8"), boundary.previous);
  const state = f.state();
  assert.equal(state.tasks[0]?.status, "no-findings");
  assert.equal(state.tasks[0]?.attempts.length, 1);
  assert.equal(state.tasks[1]?.status, "running");
  assert.equal(state.tasks[1]?.attempts[0]?.endedAt, null);
  assert.equal(f.events().length, 2);
  assert.ok(state.owner && !alive(state.owner.pid));
  assert.match(f.run(["report", state.id]).stdout, /status: interrupted/);
});
