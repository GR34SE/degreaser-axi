import { setTimeout } from "node:timers/promises";
import { admissionLock } from "../../state/locks.ts";
import {
  cleanInterruptedOwner,
  ownerRecoveryGuidance,
  verifyOwner,
} from "../../state/ownership.ts";
import type { Run } from "../../state/run.ts";
import { observedStatus } from "../../state/status.ts";
import { loadInput, loadRun } from "../../state/store.ts";
import { StateError } from "../../util/errors.ts";

export async function cancelReview(run: Run) {
  const id = run.id;
  loadInput(run);
  // Admission publishes the run before the detached owner publishes its PID.
  const startupEnd = Date.now() + 10_000;
  while (
    observedStatus(run) === "running" &&
    !run.owner &&
    Date.now() < startupEnd
  ) {
    await setTimeout(100);
    run = loadRun(run.repository, id);
  }
  // Serialize even terminal no-ops with resume's old-state -> new-owner admission.
  let unlock: () => void;
  try {
    unlock = admissionLock(run);
  } catch (error) {
    if (error instanceof StateError && error.code === "run-busy")
      throw new StateError(
        error.code,
        `Cancellation was not applied. ${error.message} After admission finishes, retry degreaser-axi cancel ${id}.`,
      );
    throw error;
  }
  try {
    run = loadRun(run.repository, id);
    const observed = observedStatus(run);
    if (observed === "interrupted") {
      // No owner remains to join its workers: stop only verified old workers, start nothing.
      await cleanInterruptedOwner(run);
      return loadRun(run.repository, id);
    }
    if (observed !== "running") return run;
    const owner = run.owner;
    if (!owner)
      throw new StateError(
        "owner-unverified",
        `No owner is ready. Run degreaser-axi wait ${id}, then retry degreaser-axi cancel ${id}.`,
      );
    // A live PID alone is not ownership: it may have been reused for another run.
    const verified = verifyOwner(run);
    run = loadRun(run.repository, id);
    if (observedStatus(run) !== "running") return run;
    if (
      !verified ||
      run.owner?.pid !== owner.pid ||
      run.owner?.started !== owner.started
    )
      throw new StateError(
        "owner-unverified",
        `Cannot verify the active owner of ${id}; no process was signalled. ${ownerRecoveryGuidance(run)}`,
      );
    try {
      process.kill(owner.pid, "SIGTERM");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw new StateError(
          "environment-blocked",
          `Cannot signal the owner of ${id}. Run cancel from a caller permitted to signal this run; do not change global permissions.`,
        );
    }
  } finally {
    unlock();
  }
  // Only the owner writes cancellation/results and joins the worker trees.
  return loadRun(run.repository, id);
}
