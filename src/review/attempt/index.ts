import type { Identity } from "../../config/types.ts";
import { nativeProfile } from "../../modules/harness/common/profile.ts";
import {
  failureDiagnostic,
  recoveryFor,
} from "../../review/attempt/failure.ts";
import { type RunTask, sumUsage } from "../../state/run.ts";
import { ResultError } from "../../util/errors.ts";
import { executionFailure } from "../../util/exec/failure.ts";
import type { Rejection, WorkerResult } from "../ingest/types.ts";
import type { OwnerContext } from "../owner/context.ts";
import { executeWorker } from "./session.ts";

type Attempt = RunTask["attempts"][number];

interface AttemptSpec<T> {
  stage: "find" | "verify";
  identity: Identity;
  prompt: string;
  ingest: (output: string) => { value: T; rejections?: Rejection[] };
  record: (value: T, complete: boolean) => WorkerResult;
  follow?: (round: T, prior: T | undefined) => { value: T; prompt?: string };
}

const RESULT_FAILURES = [
  "environment-blocked",
  "cleanup",
  "timeout",
  "cancelled",
  "deadline",
];
const RETRIED = {
  find: ["invalid-output", "output-limit", "timeout"],
  verify: ["invalid-output", "output-limit"],
};

const usageOf = (usage: Record<string, unknown> | null) => {
  const entries = Object.entries(usage ?? {}).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" &&
      Number.isFinite(entry[1]) &&
      entry[1] >= 0,
  );
  return entries.length ? Object.fromEntries(entries) : null;
};

export async function executeAttempt<T>(
  context: OwnerContext,
  task: RunTask,
  spec: AttemptSpec<T>,
): Promise<{ value: T; complete: boolean } | null> {
  const { stopped } = context.control;
  let prompt = spec.prompt;
  if (stopped()) return null;
  const release = await context.slots.acquire();
  try {
    for (
      let attempt = 0;
      attempt <= context.input.config.maxRetries;
      attempt++
    ) {
      if (stopped()) return null;
      const outcome = await runOnce(context, task, spec, prompt);
      const last = attempt === context.input.config.maxRetries;
      if (outcome.received || outcome.final || last)
        task.limitations = [
          ...new Set([...task.limitations, ...outcome.errors]),
        ];
      if (outcome.received) return outcome.received;
      if (outcome.final || last) return null;
      if (outcome.retryPrompt) prompt = outcome.retryPrompt;
    }
    return null;
  } finally {
    release();
  }
}

async function runOnce<T>(
  context: OwnerContext,
  task: RunTask,
  spec: AttemptSpec<T>,
  prompt: string,
) {
  const { runtime, input, control, repository, slots } = context;
  const { abort, stopped, persist } = control;
  const limits = input.config.limits;
  task.status = "running";
  const record: Attempt = {
    startedAt: runtime.now(),
    endedAt: null,
    sessionId: null,
    failure: null,
    usage: null,
    stage: spec.stage,
  };
  task.attempts.push(record);
  task.usage = null;
  persist();
  const limitations: string[] = [];
  const errors: string[] = [];
  const profileTimeout = new AbortController();
  const profileTimer = setTimeout(
    () => profileTimeout.abort(),
    limits.workerTimeoutSeconds * 1000,
  );
  const signal = AbortSignal.any([abort.signal, profileTimeout.signal]);
  const attemptDeadline = record.startedAt + limits.workerTimeoutSeconds * 1000;
  let received: { value: T; complete: boolean } | undefined;
  let retryPrompt: string | undefined;
  let cleanupFailed = false;
  let nativeStop: string | undefined;
  let profiled = false;
  let gathered: { value: T; rejections: Rejection[] } | undefined;
  let rounds = 0;
  const { follow } = spec;
  const next =
    follow &&
    ((output: string) => {
      try {
        const round = spec.ingest(output);
        const step = follow(round.value, gathered?.value);
        gathered = {
          value: step.value,
          rejections: [
            ...(gathered?.rejections ?? []),
            ...(round.rejections ?? []),
          ],
        };
        rounds++;
        return step.prompt;
      } catch (error) {
        if (!rounds) return undefined;
        if (!(error instanceof ResultError)) throw error;
        limitations.push(
          `A follow-up round returned no valid result block and ended the session; earlier rounds were kept: ${error.message.slice(0, 200)}`,
        );
        return undefined;
      }
    });
  try {
    const profile = await nativeProfile(
      runtime,
      spec.identity,
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
        prompt,
        maxTurns: limits.maxTurns,
        timeoutMs: Math.max(1, attemptDeadline - runtime.now()),
        signal: abort.signal,
        onPromptStarted: slots.warm,
        ...(limits.workerIdleSeconds
          ? { idleMs: limits.workerIdleSeconds * 1000 }
          : {}),
        onActivity: () => {
          record.lastActivityAt = runtime.now();
        },
        onLifecycle: (event) => persist(event.type === "spawn"),
        ...(next ? { next } : {}),
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
      record.diagnostic = runStopped
        ? failureDiagnostic(
            outcome.diagnostic.stage,
            record.failure,
            undefined,
            nativeStop,
            "run",
          )
        : { ...outcome.diagnostic, recovery: recoveryFor(record.failure) };
    limitations.push(...outcome.limitations);
    record.usage = usageOf(outcome.usage as Record<string, unknown> | null);
    if (rounds) record.rounds = rounds;
    if (
      gathered ||
      cleanupFailed ||
      runStopped ||
      !record.failure ||
      RESULT_FAILURES.includes(record.failure)
    ) {
      try {
        const { value, rejections = [] } =
          gathered ?? spec.ingest(outcome.output);
        const complete =
          !cleanupFailed &&
          (gathered
            ? !runStopped || control.stopReason === "deadline"
            : !runStopped &&
              (!record.failure || record.failure === "environment-blocked"));
        if (complete && gathered && record.failure) {
          limitations.push(
            `A later round ended with ${record.failure}; the ${rounds} completed round(s) were kept.`,
          );
          delete record.diagnostic;
        }
        if (complete) record.failure = null;
        else
          errors.push(
            `Worker lifecycle did not finish successfully: ${record.failure}.`,
          );
        record.rejections = rejections;
        record.result = structuredClone(spec.record(value, complete));
        received = { value, complete };
      } catch (error) {
        if (!record.failure) throw error;
      }
    }
  } catch (error) {
    const runStopped = stopped();
    if (error instanceof ResultError && !error.failure)
      retryPrompt = `${spec.prompt}\n\nYour previous final result block was rejected: ${error.message.slice(0, 500)}\nReturn a corrected block that follows the response contract exactly. Do not invent evidence to satisfy the format.`;
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
    const stop = runStopped
      ? "run"
      : profileTimeout.signal.aborted && record.failure === "timeout"
        ? "ceiling"
        : undefined;
    record.diagnostic = failureDiagnostic(
      error instanceof ResultError
        ? "result-validation"
        : profiled
          ? "internal"
          : "profile",
      record.failure,
      error instanceof ResultError || stop ? undefined : error,
      nativeStop,
      stop,
    );
    errors.push(
      error instanceof ResultError
        ? error.message
        : profiled
          ? "Review stopped on an unexpected internal error; its details are not recorded."
          : "Worker could not start or complete safely. Check the selected harness installation, subscription and native policy.",
    );
  } finally {
    clearTimeout(profileTimer);
  }
  record.endedAt = runtime.now();
  if (!received) {
    record.result = null;
    record.rejections = [];
  }
  record.limitations = [...limitations, ...errors];
  task.limitations = [...new Set([...task.limitations, ...limitations])];
  task.usage = sumUsage(task.attempts.map((a) => a.usage));
  persist();
  return {
    received,
    retryPrompt,
    errors,
    final:
      cleanupFailed ||
      stopped() ||
      record.diagnostic?.stop === "ceiling" ||
      !RETRIED[spec.stage].includes(record.failure ?? ""),
  };
}
