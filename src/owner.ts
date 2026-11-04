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
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const deadline = setTimeout(
    () => {
      stopReason = "deadline";
      stop();
    },
    Math.max(1, run.deadline - Date.now()),
  );
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
        if (abort.signal.aborted) {
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
        try {
          const profile = await nativeProfile(task.assignment);
          const outcome = await executeWorker(
            {
              cwd: repository,
              prompt: prompt.text,
              maxTurns: input.config.limits.maxTurns,
              timeoutMs: input.config.limits.workerTimeoutSeconds * 1000,
              signal: abort.signal,
              onPromptStarted: started,
            },
            profile,
          );
          record.sessionId = outcome.sessionId ?? null;
          record.failure = abort.signal.aborted
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
          if (!record.failure || record.failure === "environment-blocked") {
            try {
              const validated = ingestResult(
                outcome.output,
                task.assignment.aspect,
                input,
              );
              task.result = validated.result;
              task.rejections = validated.rejections;
              task.status = validated.result.status;
              record.failure = null;
            } catch (error) {
              if (!record.failure) throw error;
              task.status = "failed";
            }
          } else task.status = abort.signal.aborted ? "cancelled" : "failed";
        } catch (error) {
          task.status = "failed";
          record.failure =
            error instanceof ResultError
              ? "invalid-output"
              : "environment-blocked";
          task.limitations.push(
            error instanceof ResultError
              ? error.message
              : "Worker could not start or complete safely. Check the selected harness installation, subscription and native policy.",
          );
        }
        record.endedAt = Date.now();
        persist();
        if (record.failure !== "invalid-output" && record.failure !== "timeout")
          break;
      }
      if (task.status === "cancelled") {
        task.limitations.push(`Unexamined aspect: ${stopReason}.`);
        persist();
      }
    }
    const pending = run.tasks.filter((t) => !resolved(t));
    const first = pending.shift();
    if (first) {
      let release = () => {};
      const warm = new Promise<void>((resolve) => {
        release = resolve;
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
      const firstWork = launch(first, release);
      // Failure before inference also releases admission; never deadlock warmup.
      await Promise.race([warm, firstWork]);
      const limit = input.config.concurrency ?? run.tasks.length;
      for (const task of pending) {
        if (active.size >= limit) await Promise.race(active);
        launch(task);
      }
      await Promise.all(active);
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
