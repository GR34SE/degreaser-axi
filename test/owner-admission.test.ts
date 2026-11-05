import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { alive, queueFixture, until } from "./queue-fixture.ts";

const faultLoader = fileURLToPath(
  new URL("./fixtures/storage-fault.mjs", import.meta.url),
);
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

test("cancel during effective resumed admission refuses explicitly instead of returning the old terminal report", async (t) => {
  const f = queueFixture(t, { concurrency: 1 });
  f.setPlan({ workers: { A06: { result: "" } } });
  f.start(["--aspects", "A04,A06"]);
  assert.equal(f.finish().status, 1);
  const before = f.state();
  const oldOwner = before.owner;
  assert.ok(oldOwner);
  await until(() => !alive(oldOwner.pid), "First owner exits");
  const directory = join(f.root, ".degreaser/runs", before.id);
  const bytes = readFileSync(join(directory, "run.json"));
  const marker = f.gate("admitting.json");
  const fault = f.gate("fault.json");
  writeFileSync(
    fault,
    JSON.stringify({
      mode: "resume-admission",
      marker,
      release: f.gate("admit"),
    }),
  );
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  const resumed = capture(
    f.launch(["resume", before.id, "--wait", "1"], {
      imports: [faultLoader],
      env: { SYNTHETIC_STORAGE_FAULT: fault },
    }),
  );
  let response: ReturnType<typeof f.run>;
  try {
    await until(
      () => existsSync(marker),
      "Replacement owner reached its atomic admission publish",
    );
    assert.ok(existsSync(join(directory, "admission.lock")));
    const boundary = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(JSON.parse(boundary.previous).status, "partial");
    assert.equal(JSON.parse(boundary.proposed).status, "running");
    response = f.run(["cancel", before.id]);
    assert.deepEqual(readFileSync(join(directory, "run.json")), bytes);
  } finally {
    f.release("admit");
  }
  const result = await resumed;
  assert.equal(result.code, 3, result.stdout + result.stderr);
  await until(
    () => f.events().length === 3,
    "Only unresolved work was admitted",
  );
  // Always join the new work, even on the unfixed old-terminal response.
  assert.equal(f.run(["cancel", before.id]).status, 1);
  const after = f.state();
  assert.deepEqual(after.tasks[0], before.tasks[0]);
  assert.deepEqual(
    after.tasks[1]?.attempts.slice(0, 1),
    before.tasks[1]?.attempts,
  );
  assert.equal(after.tasks[1]?.attempts.at(-1)?.failure, "cancelled");
  assert.equal(response.status, 2, response.stdout);
  assert.match(response.stdout, /run-busy|owner-unverified/);
  assert.match(response.stdout, /[Cc]ancellation (was )?not applied/);
  assert.ok(response.stdout.includes(`cancel ${before.id}`));
});

test("a Git failure in the replacement owner's freshness check reaches the caller without mutation", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 1);
  const run = f.state(),
    owner = run.owner;
  assert.ok(owner);
  await until(() => !alive(owner.pid), "Original owner exits");
  const directory = join(f.root, ".degreaser/runs", run.id);
  const before = readFileSync(join(directory, "run.json"));
  const index = join(f.root, ".git/index"),
    originalIndex = readFileSync(index);
  const fault = f.gate("fault.json"),
    marker = f.gate("checking");
  writeFileSync(
    fault,
    JSON.stringify({
      mode: "before-admission",
      marker,
      release: f.gate("check"),
    }),
  );
  const response = capture(
    f.launch(["resume", run.id, "--wait", "1"], {
      imports: [faultLoader],
      env: { SYNTHETIC_STORAGE_FAULT: fault },
    }),
  );
  try {
    await until(
      () => existsSync(marker),
      "Caller passed freshness; detached owner is about to check",
    );
    writeFileSync(index, "broken index");
    f.release("check");
    const result = await response;
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /error: invalid-input/);
    assert.match(result.stdout, /Git ls-files failed/);
    assert.doesNotMatch(result.stdout, /input-changed|owner-failed/);
    assert.deepEqual(readFileSync(join(directory, "run.json")), before);
    assert.equal(f.events().length, 1);
  } finally {
    f.release("check");
    await response;
    writeFileSync(index, originalIndex);
  }
});

for (const [mode, code] of [
  ["prompt-mismatch", "input-changed"],
  ["prompt-error", "owner-failed"],
] as const) {
  test(`detached ${mode} remains distinguishable in saved reports after the caller exits`, async (t) => {
    const f = queueFixture(t, { concurrency: 1 });
    const fault = f.gate("fault.json");
    writeFileSync(fault, JSON.stringify({ mode, afterAdmission: true }));
    f.setPlan({ workers: { A04: { resultGate: f.gate("peer") } } });
    const caller = await capture(
      f.launch(
        [
          "review",
          "--scope",
          "worktree",
          "--task",
          "Update source",
          "--aspects",
          "A04,A06",
          "--wait",
          "1",
        ],
        { imports: [faultLoader], env: { SYNTHETIC_STORAGE_FAULT: fault } },
      ),
    );
    assert.equal(caller.code, 3, caller.stdout + caller.stderr);
    const owner = f.state().owner;
    assert.ok(owner && alive(owner.pid));
    f.release("peer");
    await until(() => !alive(owner.pid), "Detached failing owner exits");
    const failed = f.state();
    assert.equal(f.events().length, 1);
    assert.equal(failed.tasks[0]?.status, "no-findings");
    assert.deepEqual(failed.tasks[1]?.attempts, []);
    assert.equal(failed.executions?.at(-1)?.failure?.code, code);
    const report = f.run(["report", failed.id]);
    assert.equal(report.status, 1, report.stdout);
    assert.match(report.stdout, new RegExp(code));
    if (code === "input-changed")
      assert.ok(!report.stdout.includes(`degreaser-axi resume ${failed.id}`));
    assert.doesNotMatch(report.stdout, /heartbeat|SECRET-canary/i);
    assert.doesNotMatch(JSON.stringify(failed), /SECRET-canary/);
    assert.equal(failed.status, "partial");
    f.setPlan();
    const resumed = f.run(["resume", failed.id, "--wait", "20"]);
    assert.equal(resumed.status, 0, resumed.stdout);
    assert.deepEqual(f.state().tasks[0], failed.tasks[0]);
    assert.deepEqual(f.state().executions?.[0], failed.executions?.[0]);
    assert.match(
      f.run(["report", failed.id, "--full"]).stdout,
      new RegExp(code),
    );
  });
}
