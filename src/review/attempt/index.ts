import type { RunTask } from "../../state/run.ts";
import type { OwnerContext } from "../owner/context.ts";
import { backOffThrottle } from "../owner/throttle.ts";
import { type AttemptSpec, runOnce } from "./run-once.ts";

export async function executeAttempt<T>(
  context: OwnerContext,
  task: RunTask,
  spec: AttemptSpec<T>,
): Promise<{
  value: T | null;
  complete: boolean;
  failure: string | null;
  cleanupFailed: boolean;
  throttled: boolean;
}> {
  const { stopped } = context.control;
  let prompt = spec.prompt();
  const empty = () => ({
    value: null,
    complete: false,
    failure: context.control.stopReason,
    cleanupFailed: false,
    throttled: false,
  });
  if (stopped()) return empty();
  const releaseStage =
    spec.stage === "verify" ? await context.verifierSlots.acquire() : undefined;
  let release: (() => void) | undefined;
  try {
    release = await context.slots.acquire();
    const retries = spec.stage === "find" ? context.input.config.maxRetries : 0;
    let retriedThrottle = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (stopped()) return empty();
      const outcome = await runOnce(context, task, spec, prompt);
      const last = attempt === retries;
      if (
        spec.stage === "find" &&
        outcome.throttled &&
        !retriedThrottle &&
        !last &&
        !outcome.cleanupFailed &&
        !stopped()
      ) {
        retriedThrottle = true;
        const backoff = backOffThrottle(context, task);
        release();
        release = undefined;
        if (!(await backoff)) return empty();
        release = await context.slots.acquire();
        prompt = spec.prompt();
        continue;
      }
      if (outcome.received || outcome.final || last)
        task.limitations = [
          ...new Set([...task.limitations, ...outcome.errors]),
        ];
      if (outcome.received || outcome.final || last)
        return {
          value: outcome.received?.value ?? null,
          complete: outcome.received?.complete ?? false,
          failure: outcome.failure,
          cleanupFailed: outcome.cleanupFailed,
          throttled: outcome.throttled,
        };
      prompt = outcome.retryPrompt ?? spec.prompt();
    }
    return empty();
  } finally {
    release?.();
    releaseStage?.();
  }
}
