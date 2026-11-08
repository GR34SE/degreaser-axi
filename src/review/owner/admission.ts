import {
  admissionLock,
  checkOwnerLock,
  replaceOwnerLock,
} from "../../state/locks.ts";
import {
  assertAvailable,
  cleanInterruptedOwner,
  needsCleanup,
} from "../../state/ownership.ts";
import { type Run, resolved } from "../../state/run.ts";
import {
  loadInput,
  loadRun,
  runDirectory,
  saveRun,
} from "../../state/store.ts";
import { StateError } from "../../util/errors.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { assertFresh } from "../prepare/freshness.ts";
import type { ResumeControls } from "../types.ts";

export async function admitRun(
  runtime: Runtime,
  repository: string,
  id: string,
  controls?: ResumeControls,
) {
  const startedAt = runtime.now();
  let run = loadRun(repository, id);
  let input = loadInput(run);
  const dir = runDirectory(repository, id);
  const unlockAdmission = admissionLock(run);
  let unlockOwner: () => void;
  let execution: NonNullable<Run["executions"]>[number];
  try {
    run = loadRun(repository, id);
    input = loadInput(run);
    assertAvailable(run, controls === undefined);
    if (controls) {
      assertFresh(runtime, run, input);
      if (run.status === "completed")
        throw new StateError(
          "already-completed",
          `Run is complete. Use degreaser-axi report ${id}.`,
        );
      if (
        controls.deadlineSeconds === undefined &&
        runtime.now() >= run.deadline
      )
        throw new StateError(
          "deadline-expired",
          `Original deadline expired. Deliberately renew it with degreaser-axi resume ${id} --deadline 900, or start a new review.`,
        );
    }
    checkOwnerLock(run);
    if (needsCleanup(run)) await cleanInterruptedOwner(run);
    const ownership = replaceOwnerLock(run);
    unlockOwner = ownership.release;
    if (controls?.deadlineSeconds !== undefined)
      run.deadline = startedAt + controls.deadlineSeconds * 1000;
    const concurrency =
      controls?.concurrency ??
      run.executions?.at(-1)?.concurrency ??
      input.config.concurrency;
    input.config.concurrency = concurrency;
    run.executions ??= [];
    execution = {
      startedAt,
      deadline: run.deadline,
      concurrency,
      waitSeconds: controls?.waitSeconds ?? input.waitSeconds,
    };
    run.executions.push(execution);
    for (const task of run.tasks.filter((t) => !resolved(t))) {
      const last = task.attempts.at(-1);
      if (last && last.endedAt === null) {
        last.endedAt = runtime.now();
        last.failure = "interrupted";
      }
    }
    run.status = "running";
    run.owner = ownership.owner;
    try {
      saveRun(run);
    } catch (error) {
      unlockOwner();
      throw error;
    }
  } finally {
    unlockAdmission();
  }
  return { run, input, dir, execution, unlockOwner };
}
