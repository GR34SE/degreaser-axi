import { nativeProfile } from "../../modules/harness/common/profile.ts";
import {
  failureDiagnostic,
  recoveryFor,
} from "../../review/attempt/failure.ts";
import type { RunTask } from "../../state/run.ts";
import { ResultError } from "../../util/errors.ts";
import { executionFailure } from "../../util/exec/failure.ts";
import { mergePass } from "../ingest/coverage.ts";
import type { WorkerResult } from "../ingest/types.ts";
import { ingestResult } from "../ingest/verify-quotes.ts";
import type { OwnerContext } from "../owner/context.ts";
import type { ReviewInput } from "../types.ts";
import { executeWorker } from "./session.ts";

export async function executeAttempt(
  context: OwnerContext,
  task: RunTask,
  text: string,
  passInput: ReviewInput,
  accumulated: WorkerResult | null,
  started: () => void,
  resolving = false,
): Promise<WorkerResult | null> {
  const { runtime, input, control, repository } = context;
  const { abort, stopped, persist } = control;
  let merged: WorkerResult | null = null;
  const basePrompt = text;
  for (let attempt = 0; attempt <= input.config.maxRetries; attempt++) {
    if (stopped()) {
      task.status = "cancelled";
      break;
    }
    task.status = "running";
    task.usage = null;
    const record: RunTask["attempts"][number] = {
      startedAt: runtime.now(),
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
    let profiled = false;
    try {
      const profile = await nativeProfile(
        runtime,
        task.assignment,
        "review",
        signal,
        () => persist(true),
      );
      profiled = true;
      if (stopped()) abort.signal.throwIfAborted();
      if (runtime.now() >= attemptDeadline) profileTimeout.abort();
      signal.throwIfAborted();
      clearTimeout(profileTimer);
      const outcome = await executeWorker(
        {
          cwd: repository,
          prompt: text,
          maxTurns: input.config.limits.maxTurns,
          timeoutMs: Math.max(1, attemptDeadline - runtime.now()),
          signal: abort.signal,
          onPromptStarted: started,
          ...(input.config.limits.workerIdleSeconds
            ? { idleMs: input.config.limits.workerIdleSeconds * 1000 }
            : {}),
          onActivity: () => {
            record.lastActivityAt = runtime.now();
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
          ? control.stopReason
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
            runtime,
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
          merged = mergePass(
            input,
            accumulated,
            pass,
            earlierApplicable,
            resolving,
          );
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
      if (error instanceof ResultError && !error.failure)
        text = `${basePrompt}\n\nYour previous final result block was rejected: ${error.message.slice(0, 500)}\nReturn a corrected block that follows the response contract exactly. Do not invent evidence to satisfy the format.`;
      const failure =
        error instanceof ResultError
          ? (error.failure ?? "invalid-output")
          : executionFailure(error);
      record.failure =
        failure === "runtime" || failure === "cancelled"
          ? runStopped
            ? control.stopReason
            : profileTimeout.signal.aborted
              ? "timeout"
              : failure
          : failure;
      record.diagnostic = failureDiagnostic(
        error instanceof ResultError
          ? "result-validation"
          : profiled
            ? "internal"
            : "profile",
        record.failure,
        error instanceof ResultError ? undefined : error,
        nativeStop,
      );
      task.limitations.push(
        error instanceof ResultError
          ? error.message
          : profiled
            ? "Review stopped on an unexpected internal error; its details are not recorded."
            : "Worker could not start or complete safely. Check the selected harness installation, subscription and native policy.",
      );
    } finally {
      clearTimeout(profileTimer);
    }
    if (task.status === "failed" && stopped()) task.status = "cancelled";
    record.endedAt = runtime.now();
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
