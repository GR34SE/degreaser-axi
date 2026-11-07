export type WorkerFailure =
  | "model-unavailable"
  | "authentication"
  | "network"
  | "rate-limited"
  | "account-disabled"
  | "environment-blocked"
  | "timeout"
  | "cancelled"
  | "runtime"
  | "cleanup"
  | "output-limit";

const codes: Record<string, WorkerFailure> = {
  ACP_MODEL_UNSUPPORTED: "model-unavailable",
  MODEL_NOT_FOUND: "model-unavailable",
  MODEL_UNAVAILABLE: "model-unavailable",
  AUTH_REQUIRED: "authentication",
  AUTHENTICATION_FAILED: "authentication",
  UNAUTHORIZED: "authentication",
  RATE_LIMITED: "rate-limited",
  RATE_LIMIT_EXCEEDED: "rate-limited",
  QUOTA_EXCEEDED: "rate-limited",
  INSUFFICIENT_QUOTA: "rate-limited",
  ACCOUNT_LIMIT_EXCEEDED: "rate-limited",
  ACCOUNT_DISABLED: "account-disabled",
  ACCOUNT_SUSPENDED: "account-disabled",
  PERMISSION_DENIED: "environment-blocked",
  PERMISSION_PROMPT_UNAVAILABLE: "environment-blocked",
  EACCES: "environment-blocked",
  EPERM: "environment-blocked",
  ERR_ACCESS_DENIED: "environment-blocked",
  ECONNRESET: "network",
  ECONNREFUSED: "network",
  ENETUNREACH: "network",
  EHOSTUNREACH: "network",
  ENOTFOUND: "network",
  EAI_AGAIN: "network",
  TIMEOUT: "timeout",
  ETIMEDOUT: "timeout",
  QUEUE_REQUEST_CANCELLED: "cancelled",
};
const httpStatuses: Record<string, WorkerFailure> = {
  "401": "authentication",
  "429": "rate-limited",
};

function causeChain(error: unknown) {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    chain.push(record);
    current = record.cause;
  }
  return chain;
}

/** Prefer machine causes, including wrapped errors, to unstructured provider prose. */
export function workerFailure(error: unknown): WorkerFailure {
  const chain = causeChain(error);
  for (const key of ["detailCode", "code"]) {
    for (const record of chain) {
      const code = record[key];
      if (typeof code === "string") {
        const kind = codes[code.toUpperCase()];
        if (kind) return kind;
      }
    }
  }
  if (chain.some((record) => record.name === "TimeoutError")) return "timeout";
  const messages = chain.flatMap((record) =>
    typeof record.message === "string" ? [record.message] : [],
  );
  if (typeof error === "string") messages.push(error);
  const message = messages.join("\n");
  if (/\baccount[ _-](?:disabled|suspended)\b/i.test(message))
    return "account-disabled";
  for (const record of chain) {
    for (const key of ["detailCode", "code", "status", "statusCode"]) {
      const status = record[key];
      if (typeof status === "number" || typeof status === "string") {
        const kind = httpStatuses[String(status)];
        if (kind) return kind;
      }
    }
  }
  if (
    /\bmodel\b[^\n]*(?:unavailable|unsupported|not found|does not exist)|\bunknown model\b/i.test(
      message,
    )
  )
    return "model-unavailable";
  if (
    /\b(?:authentication|authorization|auth|login|credentials?) (?:required|failed|invalid|expired)\b|\bunauthorized\b|\bnot logged in\b/i.test(
      message,
    )
  )
    return "authentication";
  if (
    /\brate[ _-]?limit(?:ed|_exceeded)?\b|\bquota[ _-](?:exceeded|exhausted|limit)\b|\binsufficient[ _]quota\b|\b(?:account|usage) (?:usage )?limit\b|\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?)\s*[:=]?\s*429\b|\btoo many requests\b/i.test(
      message,
    )
  )
    return "rate-limited";
  if (
    /\bpermission denied\b|\boperation not permitted\b|\b(?:EACCES|EPERM)\b/i.test(
      message,
    )
  )
    return "environment-blocked";
  if (/\b(?:timeout|timed out)\b/i.test(message)) return "timeout";
  if (
    /\b(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN)\b|\bnetwork (?:is unreachable|error)\b|\bfetch failed\b/i.test(
      message,
    )
  )
    return "network";
  return "runtime";
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
  ...Object.keys(codes),
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
