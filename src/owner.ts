import { join } from "node:path";
import { mergePass, progressed, uncovered } from "./coverage.ts";
import { assertFresh } from "./freshness.ts";
import { nativeProfile } from "./native-profile.ts";
import {
  admissionLock,
  assertAvailable,
  captureOwner,
  checkOwnerLock,
  cleanInterruptedOwner,
  needsCleanup,
  replaceOwnerLock,
} from "./ownership.ts";
import { assemblePrompt, continuationSection } from "./prompt.ts";
import { ingestResult, ResultError, type WorkerResult } from "./results.ts";
import {
  loadInput,
  loadRun,
  type Run,
  type RunTask,
  resolved,
  runDirectory,
  StateError,
  saveRun,
  terminalStatus,
} from "./storage.ts";
import {
  failureDiagnostic,
  recoveryFor,
  workerFailure,
} from "./worker-failure.ts";
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
  let execution: NonNullable<Run["executions"]>[number];
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
  const stop = () => {
    if (!abort.signal.aborted) {
      if (stopReason === "cancelled" || stopReason === "deadline")
        execution.stopReason = stopReason;
      abort.abort();
    }
  };
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
  /** Inspection failures are transient; only worker launch requires fresh identities. */
  const persist = (verify = false) => {
    if (persistenceError) throw persistenceError;
    if (verify || !run.owner) {
      try {
        run.owner = captureOwner(run.owner);
      } catch (error) {
        throw fail(error, "Owner process identities could not be captured.");
      }
    } else {
      try {
        run.owner = captureOwner(run.owner);
      } catch (error) {
        if (!(error instanceof StateError)) throw error;
        run.owner = { ...run.owner, heartbeat: Date.now() };
      }
    }
    try {
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
    return fatalError;
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
        join(dir, "input", "patch.diff"),
      );
      if (prompt.promptHash !== task.promptHash)
        throw new StateError(
          "input-changed",
          `Prompt identity for ${task.assignment.aspect} differs from ${join(dir, "run.json")}. Start a new review with the current package.`,
        );
      // Resume continues coverage from the persisted partial result.
      let accumulated =
        task.result?.status === "incomplete" &&
        uncovered(input, task.result.examinedPaths ?? []).length
          ? task.result
          : null;
      for (;;) {
        const missing = accumulated
          ? uncovered(input, accumulated.examinedPaths ?? [])
          : null;
        const passInput = missing
          ? {
              ...input,
              paths: input.paths.filter((p) => missing.includes(p.path)),
            }
          : input;
        const text = missing
          ? `${assemblePrompt(passInput, task.assignment.aspect, join(dir, "input", "patch.diff"), 0).text}\n\n${continuationSection(missing, accumulated?.examinedPaths?.length ?? 0)}`
          : prompt.text;
        const pass = await runPass(task, text, passInput, accumulated, started);
        if (!pass) {
          if (accumulated) {
            task.result = accumulated;
            if (task.status === "failed") task.status = "incomplete";
          }
          break;
        }
        const advanced = progressed(accumulated, pass);
        accumulated = pass;
        // Each further pass must add coverage, so the loop is bounded by the path count.
        if (
          pass.status !== "incomplete" ||
          !advanced ||
          stopped() ||
          task.attempts.at(-1)?.failure ||
          !uncovered(input, pass.examinedPaths ?? []).length
        )
          break;
      }
      if (task.status === "cancelled") {
        task.limitations.push(`Unexamined aspect: ${stopReason}.`);
        persist();
      }
    }
    /** One assignment pass with bounded retries; returns the merged result or null. */
    async function runPass(
      task: RunTask,
      text: string,
      passInput: typeof input,
      accumulated: WorkerResult | null,
      started: () => void,
    ): Promise<WorkerResult | null> {
      let merged: WorkerResult | null = null;
      for (let attempt = 0; attempt <= input.config.maxRetries; attempt++) {
        if (stopped()) {
          task.status = "cancelled";
          break;
        }
        task.status = "running";
        task.usage = null;
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
        let cleanupFailed = false;
        let nativeStop: string | undefined;
        try {
          const profile = await nativeProfile(
            task.assignment,
            "review",
            signal,
            () => persist(true),
          );
          if (stopped()) abort.signal.throwIfAborted();
          if (Date.now() >= attemptDeadline) profileTimeout.abort();
          signal.throwIfAborted();
          clearTimeout(profileTimer);
          const outcome = await executeWorker(
            {
              cwd: repository,
              prompt: text,
              maxTurns: input.config.limits.maxTurns,
              timeoutMs: Math.max(1, attemptDeadline - Date.now()),
              signal: abort.signal,
              onPromptStarted: started,
              ...(input.config.limits.workerIdleSeconds
                ? { idleMs: input.config.limits.workerIdleSeconds * 1000 }
                : {}),
              onActivity: () => {
                record.lastActivityAt = Date.now();
              },
              onLifecycle: (event) => persist(event.type === "spawn"),
              onSessionReady: (id) => {
                record.sessionId = id;
                persist();
              },
            },
            profile,
          );
          record.sessionId = outcome.sessionId ?? null;
          cleanupFailed = outcome.cleanupFailed;
          nativeStop = outcome.stopReason;
          const runStopped = stopped();
          record.failure =
            runStopped && (!outcome.failure || outcome.failure === "cancelled")
              ? stopReason
              : (outcome.failure ?? null);
          if (outcome.diagnostic && record.failure)
            record.diagnostic = {
              ...outcome.diagnostic,
              recovery: recoveryFor(record.failure),
            };
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
            cleanupFailed ||
            runStopped ||
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
                passInput,
                accumulated?.findings,
              );
              const pass = validated.result;
              receivedResult = true;
              task.rejections = [
                ...(accumulated ? task.rejections : []),
                ...validated.rejections,
              ];
              record.rejections = structuredClone(validated.rejections);
              if (
                !cleanupFailed &&
                !runStopped &&
                (!record.failure || record.failure === "environment-blocked")
              )
                record.failure = null;
              else {
                pass.status = "incomplete";
                pass.examinedPaths = [];
                pass.limitations.push(
                  `Worker lifecycle did not finish successfully: ${record.failure}.`,
                );
              }
              record.result = structuredClone(pass);
              const earlierApplicable = task.attempts.some(
                (a) =>
                  a !== record &&
                  !a.failure &&
                  a.result &&
                  a.result.status !== "not-applicable",
              );
              merged = mergePass(input, accumulated, pass, earlierApplicable);
              task.result = merged;
              task.status = merged.status;
            } catch (error) {
              if (!record.failure) throw error;
              task.status = stopped() ? "cancelled" : "failed";
            }
          } else task.status = abort.signal.aborted ? "cancelled" : "failed";
        } catch (error) {
          task.status = "failed";
          const runStopped = stopped();
          const failure =
            error instanceof ResultError
              ? "invalid-output"
              : workerFailure(error);
          record.failure =
            failure === "runtime" || failure === "cancelled"
              ? runStopped
                ? stopReason
                : profileTimeout.signal.aborted
                  ? "timeout"
                  : failure
              : failure;
          record.diagnostic = failureDiagnostic(
            error instanceof ResultError ? "result-validation" : "profile",
            record.failure,
            error instanceof ResultError ? undefined : error,
            nativeStop,
          );
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
        if (!receivedResult) record.result = null;
        if (!receivedResult) record.rejections = [];
        record.limitations = [...task.limitations];
        persist();
        if (
          receivedResult ||
          cleanupFailed ||
          !["invalid-output", "output-limit", "timeout"].includes(
            record.failure ?? "",
          )
        )
          break;
      }
      return merged;
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
  } catch (error) {
    const failure = fail(
      error,
      "Run stopped because of an unexpected owner error.",
    );
    await Promise.allSettled(active);
    // A failed store cannot reliably record its own failure. Keep its last commit.
    if (!persistenceError) {
      execution.failure = {
        code: failure.code,
        message: failure.message,
      };
      for (const task of run.tasks) {
        if (task.status === "pending" || task.status === "running") {
          task.status = "failed";
          task.limitations.push(`Unexamined aspect: ${failure.code}.`);
        }
      }
      run.status = terminalStatus(run.tasks);
      persist();
    }
    throw failure;
  } finally {
    abort.abort();
    await Promise.allSettled(active);
    clearInterval(heartbeat);
    clearTimeout(deadline);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    unlockOwner();
  }
}
