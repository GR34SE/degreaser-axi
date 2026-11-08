import { setTimeout } from "node:timers/promises";
import { admissionLock } from "../../state/locks.ts";
import {
  cleanInterruptedOwner,
  ownerRecoveryGuidance,
  verifyOwner,
} from "../../state/ownership.ts";
import type { Run } from "../../state/run.ts";
import { observeRun } from "../../state/status.ts";
import { loadInput, loadRun } from "../../state/store.ts";
import { StateError } from "../../util/errors.ts";

export async function cancelReview(run: Run) {
  const id = run.id;
  loadInput(run);
  const startupEnd = Date.now() + 10_000;
  while (
    observeRun(run).status === "running" &&
    !run.owner &&
    Date.now() < startupEnd
  ) {
    await setTimeout(100);
    run = loadRun(run.repository, id);
  }
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
    let observed: string;
    ({ run, status: observed } = observeRun(loadRun(run.repository, id)));
    if (observed === "interrupted") {
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
    const verified = verifyOwner(run);
    ({ run, status: observed } = observeRun(loadRun(run.repository, id)));
    if (observed !== "running") return run;
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
  return loadRun(run.repository, id);
}
