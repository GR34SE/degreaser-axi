import { join } from "node:path";
import { assertFresh } from "./freshness.ts";
import { nativeProfile } from "./native-profile.ts";
import {
  admissionLock,
  assertAvailable,
  captureOwner,
  checkOwnerLock,
  cleanInterruptedOwner,
  replaceOwnerLock,
} from "./ownership.ts";
import { assemblePrompt } from "./prompt.ts";
import { ingestResult, ResultError } from "./results.ts";
import {
  loadInput,
  loadRun,
  type RunTask,
  resolved,
  runDirectory,
  StateError,
  saveRun,
  terminalStatus,
} from "./storage.ts";
import { workerFailure } from "./worker-failure.ts";
import { executeWorker } from "./worker-runtime.ts";

/** Sole writer after admission. Every child is joined before the owner exits. */
export interface ResumeControls {
  concurrency?: number;
  waitSeconds?: number;
  deadlineSeconds?: number;
}
export async function ownRun(
  repository: string,
  id: string,
  controls?: ResumeControls,
  ready: () => void = () => {},
) {
  const startedAt = Date.now();
  let run = loadRun(repository, id);
  let input = loadInput(run);
  const dir = runDirectory(repository, id);
  const unlockAdmission = admissionLock(run);
  let unlockOwner: () => void;
  try {
    run = loadRun(repository, id);
    input = loadInput(run);
    assertAvailable(run, controls === undefined);
    if (controls) {
      assertFresh(run, input);
      if (run.status === "completed")
        throw new StateError(
          "already-completed",
          `Run is complete. Use degreaser-axi report ${id}.`,
        );
      if (controls.deadlineSeconds === undefined && Date.now() >= run.deadline)
        throw new StateError(
          "deadline-expired",
          `Original deadline expired. Deliberately renew it with degreaser-axi resume ${id} --deadline 900, or start a new review.`,
        );
    }
    checkOwnerLock(run);
    await cleanInterruptedOwner(run);
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
    run.executions.push({
      startedAt,
      deadline: run.deadline,
      concurrency,
      waitSeconds: controls?.waitSeconds ?? input.waitSeconds,
    });
    for (const task of run.tasks.filter((t) => !resolved(t))) {
      const last = task.attempts.at(-1);
      if (last && last.endedAt === null) {
        last.endedAt = Date.now();
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
  const abort = new AbortController();
  const active = new Set<Promise<void>>();
  let stopReason = "cancelled";
  const stop = () => abort.abort();
  const expire = () => {
    if (!abort.signal.aborted) {
      stopReason = "deadline";
      stop();
    }
  };
  const stopped = () => {
    if (Date.now() >= run.deadline) expire();
    return abort.signal.aborted;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const deadline = setTimeout(expire, Math.max(1, run.deadline - Date.now()));
  let persistenceError: StateError | undefined;
  let fatalError: StateError | undefined;
  const persist = () => {
    if (persistenceError) throw persistenceError;
    try {
      run.owner = captureOwner(run.owner);
      saveRun(run);
    } catch (error) {
      persistenceError =
        error instanceof StateError
          ? error
          : new StateError(
              "state-write-failed",
              `Could not persist run: ${join(dir, "run.json")}`,
            );
      throw persistenceError;
    }
  };
  const fail = (error: unknown, message: string) => {
    fatalError ??=
      error instanceof StateError
        ? error
        : new StateError("owner-failed", message);
    stopReason = fatalError.code;
    stop();
  };
  const heartbeat = setInterval(() => {
    try {
      persist();
    } catch (error) {
      fail(error, "Owner heartbeat could not be persisted.");
    }
  }, 2000);
  try {
    ready();
    async function work(task: RunTask, started: () => void = () => {}) {
      const prompt = assemblePrompt(
        input,
        task.assignment.aspect,
        join(dir, "input", "patch.json"),
      );
      if (prompt.promptHash !== task.promptHash)
        throw new StateError(
          "input-changed",
          `Prompt identity for ${task.assignment.aspect} differs from ${join(dir, "run.json")}. Start a new review with the current package.`,
        );
      for (let attempt = 0; attempt <= input.config.maxRetries; attempt++) {
        if (stopped()) {
          task.status = "cancelled";
          break;
        }
        task.status = "running";
        const record: RunTask["attempts"][number] = {
          startedAt: Date.now(),
          endedAt: null,
          sessionId: null,
          failure: null,
          usage: null,
        };
        task.attempts.push(record);
        persist();
        const profileTimeout = new AbortController();
        const profileTimer = setTimeout(
          () => profileTimeout.abort(),
          input.config.limits.workerTimeoutSeconds * 1000,
        );
        const signal = AbortSignal.any([abort.signal, profileTimeout.signal]);
        const attemptDeadline =
          record.startedAt + input.config.limits.workerTimeoutSeconds * 1000;
        let receivedResult = false;
        try {
          const profile = await nativeProfile(
            task.assignment,
            "review",
            signal,
            persist,
          );
          if (stopped()) abort.signal.throwIfAborted();
          if (Date.now() >= attemptDeadline) profileTimeout.abort();
          signal.throwIfAborted();
          clearTimeout(profileTimer);
          const outcome = await executeWorker(
            {
              cwd: repository,
              prompt: prompt.text,
              maxTurns: input.config.limits.maxTurns,
              timeoutMs: Math.max(1, attemptDeadline - Date.now()),
              signal: abort.signal,
              onPromptStarted: started,
              onLifecycle: () => persist(),
              onSessionReady: (id) => {
                record.sessionId = id;
                persist();
              },
            },
            profile,
          );
          record.sessionId = outcome.sessionId ?? null;
          record.failure =
            outcome.failure === "cleanup"
              ? "cleanup"
              : stopped()
                ? stopReason
                : (outcome.failure ?? null);
          task.limitations = outcome.limitations;
          task.usage = outcome.usage
            ? Object.fromEntries(
                Object.entries(outcome.usage).filter(
                  (entry): entry is [string, number] =>
                    typeof entry[1] === "number" &&
                    Number.isFinite(entry[1]) &&
                    entry[1] >= 0,
                ),
              )
            : null;
          if (task.usage && !Object.keys(task.usage).length) task.usage = null;
          record.usage = task.usage;
          if (
            !record.failure ||
            [
              "environment-blocked",
              "cleanup",
              "timeout",
              "cancelled",
              "deadline",
            ].includes(record.failure)
          ) {
            try {
              const validated = ingestResult(
                outcome.output,
                task.assignment.aspect,
                input,
              );
              task.result = validated.result;
              receivedResult = true;
              task.rejections = validated.rejections;
              task.status = validated.result.status;
              if (!record.failure || record.failure === "environment-blocked")
                record.failure = null;
              else {
                task.result.status = "incomplete";
                task.result.limitations.push(
                  `Worker lifecycle did not finish successfully: ${record.failure}.`,
                );
                task.status = "incomplete";
              }
            } catch (error) {
              if (!record.failure) throw error;
              task.status = stopped() ? "cancelled" : "failed";
            }
          } else task.status = abort.signal.aborted ? "cancelled" : "failed";
        } catch (error) {
          task.status = "failed";
          record.failure = stopped()
            ? stopReason
            : profileTimeout.signal.aborted
              ? "timeout"
              : error instanceof ResultError
                ? "invalid-output"
                : workerFailure(error);
          task.limitations.push(
            error instanceof ResultError
              ? error.message
              : "Worker could not start or complete safely. Check the selected harness installation, subscription and native policy.",
          );
        } finally {
          clearTimeout(profileTimer);
        }
        if (task.status === "failed" && stopped()) task.status = "cancelled";
        record.endedAt = Date.now();
        record.result = receivedResult ? structuredClone(task.result) : null;
        record.rejections = receivedResult
          ? structuredClone(task.rejections)
          : [];
        record.limitations = [...task.limitations];
        persist();
        if (
          receivedResult ||
          (record.failure !== "invalid-output" && record.failure !== "timeout")
        )
          break;
      }
      if (task.status === "cancelled") {
        task.limitations.push(`Unexamined aspect: ${stopReason}.`);
        persist();
      }
    }
    const pending = run.tasks.filter((t) => !resolved(t));
    if (pending.length) {
      let warmed = false;
      let release = () => {};
      const warm = new Promise<void>((resolve) => {
        release = () => {
          warmed = true;
          resolve();
        };
      });
      const launch = (task: RunTask, started?: () => void) => {
        const promise = work(task, started)
          .catch((error: unknown) => {
            fail(
              error,
              `Aspect ${task.assignment.aspect} could not complete because of an unexpected owner task error.`,
            );
          })
          .finally(() => {
            active.delete(promise);
          });
        active.add(promise);
        return promise;
      };
      const limit = input.config.concurrency ?? run.tasks.length;
      for (const task of pending) {
        if (stopped()) break;
        if (active.size >= limit) await Promise.race(active);
        if (stopped()) break;
        const work = launch(task, release);
        // A cold failure advances one task, not the entire still-cold fleet.
        if (!warmed) await Promise.race([warm, work]);
      }
      await Promise.all(active);
    }
    if (stopped()) {
      for (const task of run.tasks.filter(
        (task) => task.status === "pending",
      )) {
        task.status = "cancelled";
        task.limitations.push(`Unexamined aspect: ${stopReason}.`);
      }
    }
    if (fatalError) throw fatalError;
    run.status = terminalStatus(run.tasks);
    persist();
  } finally {
    stop();
    await Promise.allSettled(active);
    clearInterval(heartbeat);
    clearTimeout(deadline);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    unlockOwner();
  }
}
