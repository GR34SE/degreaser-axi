import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { ownRun } from "../../dist/src/owner.js";
import { loadInput, loadRun, saveRun } from "../../dist/src/storage.js";

const [mode, repository, id] = process.argv.slice(2);
try {
  if (mode === "owner") {
    await ownRun(repository, id);
  } else if (mode === "write") {
    const run = loadRun(repository, id);
    run.deadline += 1000;
    saveRun(run);
  } else if (mode === "reader") {
    const committed = new Map();
    let reads = 0;
    const statuses = new Set();
    const end = Date.now() + 20000;
    process.send("ready");
    for (;;) {
      const run = loadRun(repository, id);
      loadInput(run);
      reads++;
      statuses.add(run.status);
      for (const task of run.tasks) {
        const old = committed.get(task.assignment.aspect);
        if (old) {
          assert.deepEqual(
            task.attempts.slice(0, old.attempts.length),
            old.attempts,
          );
          if (old.result) assert.deepEqual(task, old);
        }
        if (task.attempts.every((a) => a.endedAt !== null))
          committed.set(task.assignment.aspect, task);
      }
      if (run.status !== "running") {
        assert.equal(run.status, "completed");
        assert.equal(run.tasks.length, 16);
        for (const task of run.tasks) {
          assert.equal(task.status, "no-findings");
          assert.equal(
            task.attempts.length,
            task.assignment.aspect === "low-value-comments" ? 2 : 1,
          );
        }
        break;
      }
      assert.ok(Date.now() < end, "Reader watchdog");
      await setTimeout(2);
    }
    console.log(JSON.stringify({ reads, statuses: [...statuses] }));
    process.disconnect();
  } else {
    throw new Error("Unknown storage fixture mode");
  }
} catch (error) {
  console.log(JSON.stringify({ code: error.code, message: error.message }));
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
