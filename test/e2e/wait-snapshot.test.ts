import assert from "node:assert/strict";
import test from "node:test";
import { waitFor } from "../../src/cli/commands/shared/run.ts";
import { createFactory } from "../../src/cli/factory.ts";
import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

// The owner can persist its result and exit between a caller's read and its
// liveness check; the caller must report the persisted result, not an interruption.
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
