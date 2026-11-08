import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fixture } from "../../test/utils/git-fixture.ts";
import { prepareReview } from "../../test/utils/input.ts";
import { runtime } from "../../test/utils/runtime.ts";
import { createRun } from "../review/prepare/create.ts";
import { terminalStatus } from "./run.ts";
import { observeRun } from "./status.ts";
import { saveRun } from "./store.ts";

test("a running record read before its owner persisted a terminal record and exited is not interrupted", (t) => {
  const f = fixture(t);
  f.write("source.ts", "export const value = 1;\n");
  const run = createRun(
    runtime(),
    prepareReview(
      [
        "--scope",
        "worktree",
        "--task",
        "Update",
        "--aspects",
        "low-value-comments",
      ],
      f.root,
    ),
  );
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;
  assert.ok(exited);
  run.owner = { pid: exited, heartbeat: Date.now(), processes: [] };
  saveRun(run);
  const stale = structuredClone(run);

  assert.equal(observeRun(stale).status, "interrupted");

  for (const task of run.tasks) {
    task.status = "failed";
    task.limitations.push("Unexamined aspect: owner-failed.");
  }
  run.status = terminalStatus(run.tasks);
  saveRun(run);

  const observed = observeRun(stale);
  assert.equal(observed.status, run.status);
  assert.deepEqual(observed.run, run);
});
