import {
  causeChain,
  type ExecutionFailure,
  executionCodes,
} from "../../util/exec/failure.ts";

export type WorkerFailure = ExecutionFailure | "cleanup" | "output-limit";

/** Cursor returns this sentence, and no result block, when the account must add billing. */
export function billingRefusal(text: string): boolean {
  return /^\s*add a payment method to continue\s*$/i.test(text);
}

/** Lifecycle point at which an attempt stopped. Unknown stages are never invented. */
export const WORKER_STAGES = [
  "profile",
  "session-setup",
  "model-check",
  "turn-start",
  "turn-stream",
  "turn-result",
  "usage",
  "cleanup",
  "result-validation",
  "internal",
] as const;
export type WorkerStage = (typeof WORKER_STAGES)[number];

export const RECOVERIES = [
  "fix-authentication",
  "change-model",
  "wait-for-quota",
  "fix-account",
  "fix-environment",
  "retry-later",
  "resume",
  "inspect-cleanup",
  "inspect",
] as const;
export type Recovery = (typeof RECOVERIES)[number];

/** Safe, bounded facts about one failed attempt. Never provider prose or raw output. */
export interface WorkerDiagnostic {
  stage: WorkerStage;
  recovery: Recovery;
  code?: string;
  detailCode?: string;
  retryable?: boolean;
  stopReason?: string;
}

const recoveries: Partial<Record<string, Recovery>> = {
  authentication: "fix-authentication",
  "model-unavailable": "change-model",
  "rate-limited": "wait-for-quota",
  "account-disabled": "fix-account",
  "environment-blocked": "fix-environment",
  network: "retry-later",
  timeout: "resume",
  cancelled: "resume",
  deadline: "resume",
  "output-limit": "resume",
  "invalid-output": "resume",
  cleanup: "inspect-cleanup",
};
/** Unclassified failures stay "inspect": never presented as retryable by guess. */
export const recoveryFor = (failure: string | null | undefined): Recovery =>
  (failure ? recoveries[failure] : undefined) ?? "inspect";

// Codes declared by the pinned acpx runtime plus the machine codes classified above.
const knownCodes = new Set([
  "ACP_BACKEND_MISSING",
  "ACP_BACKEND_UNAVAILABLE",
  "ACP_BACKEND_UNSUPPORTED_CONTROL",
  "ACP_DISPATCH_DISABLED",
  "ACP_INVALID_RUNTIME_OPTION",
  "ACP_SESSION_INIT_FAILED",
  "ACP_TURN_FAILED",
  "RUNTIME",
  ...Object.keys(executionCodes),
]);
// ACP stop reasons; anything else is dropped rather than stored.
const stopReasons = new Set([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);
export const safeStopReason = (value: unknown) =>
  typeof value === "string" && stopReasons.has(value) ? value : undefined;

/** Keep only recognized machine fields from an error chain; unknown stays absent. */
export function failureDiagnostic(
  stage: WorkerStage,
  failure: string | null | undefined,
  error?: unknown,
  stopReason?: unknown,
): WorkerDiagnostic {
  const chain = causeChain(error);
  const pick = (key: string) => {
    for (const record of chain) {
      const value = record[key];
      if (typeof value === "string" && knownCodes.has(value.toUpperCase()))
        return value.toUpperCase();
    }
    return undefined;
  };
  const code = pick("code");
  const detailCode = pick("detailCode");
  const retryable = chain
    .map((record) => record.retryable)
    .find((value): value is boolean => typeof value === "boolean");
  const reason = safeStopReason(stopReason);
  return {
    stage,
    recovery: recoveryFor(failure),
    ...(code ? { code } : {}),
    ...(detailCode ? { detailCode } : {}),
    ...(retryable === undefined ? {} : { retryable }),
    ...(reason ? { stopReason: reason } : {}),
  };
}
