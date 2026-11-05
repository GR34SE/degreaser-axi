import { closeSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nativeProfile } from "./native-profile.ts";
import { assemblePrompt } from "./prompt.ts";
import { ingestResult, ResultError } from "./results.ts";
import {
  loadInput,
  loadRun,
  type RunTask,
  resolved,
  runDirectory,
  saveRun,
  terminalStatus,
} from "./storage.ts";
import { workerFailure } from "./worker-failure.ts";
import { executeWorker } from "./worker-runtime.ts";

/** Sole writer after admission. Every child is joined before the owner exits. */
export async function ownRun(repository: string, id: string) {
  const run = loadRun(repository, id);
  const dir = runDirectory(repository, id);
  const lockPath = join(dir, "owner.lock");
  const lock = openSync(lockPath, "wx", 0o600);
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
  const persist = () => {
    run.owner = { pid: process.pid, heartbeat: Date.now() };
    saveRun(run);
  };
  let storageFailed = false;
  const heartbeat = setInterval(() => {
    try {
      persist();
    } catch {
      storageFailed = true;
      stop();
    }
  }, 2000);
  try {
    const input = loadInput(run);
    persist();
    async function work(task: RunTask, started: () => void = () => {}) {
      const prompt = assemblePrompt(
        input,
        task.assignment.aspect,
        join(dir, "input", "patch.json"),
      );
      if (prompt.promptHash !== task.promptHash)
        throw new Error("Persisted prompt identity changed.");
      for (let attempt = 0; attempt <= input.config.maxRetries; attempt++) {
        if (stopped()) {
          task.status = "cancelled";
          break;
        }
        task.status = "running";
        const record = {
          startedAt: Date.now(),
          endedAt: null as number | null,
          sessionId: null as string | null,
          failure: null as string | null,
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
        try {
          const profile = await nativeProfile(
            task.assignment,
            "review",
            signal,
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
        persist();
        if (
          task.result ||
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
          .catch(() => {
            storageFailed = true;
            stop();
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
    if (storageFailed) throw new Error("Storage heartbeat failed");
    run.status = terminalStatus(run.tasks);
    persist();
  } finally {
    stop();
    await Promise.allSettled(active);
    clearInterval(heartbeat);
    clearTimeout(deadline);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    closeSync(lock);
    rmSync(lockPath);
  }
}
