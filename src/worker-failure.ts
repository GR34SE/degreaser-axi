export type WorkerFailure =
  | "model-unavailable"
  | "authentication"
  | "rate-limited"
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
  "401": "authentication",
  RATE_LIMITED: "rate-limited",
  RATE_LIMIT_EXCEEDED: "rate-limited",
  QUOTA_EXCEEDED: "rate-limited",
  INSUFFICIENT_QUOTA: "rate-limited",
  ACCOUNT_LIMIT_EXCEEDED: "rate-limited",
  ACCOUNT_DISABLED: "rate-limited",
  "429": "rate-limited",
  PERMISSION_DENIED: "environment-blocked",
  PERMISSION_PROMPT_UNAVAILABLE: "environment-blocked",
  EACCES: "environment-blocked",
  EPERM: "environment-blocked",
  TIMEOUT: "timeout",
  ETIMEDOUT: "timeout",
  QUEUE_REQUEST_CANCELLED: "cancelled",
};

/** Prefer machine causes, including wrapped errors, to unstructured provider prose. */
export function workerFailure(error: unknown): WorkerFailure {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    chain.push(record);
    current = record.cause;
  }
  for (const record of chain) {
    for (const key of ["detailCode", "code", "status"]) {
      const code = record[key];
      if (typeof code === "string" || typeof code === "number") {
        const kind = codes[String(code).toUpperCase()];
        if (kind) return kind;
      }
    }
    if (record.name === "TimeoutError") return "timeout";
  }
  const messages = chain.flatMap((record) =>
    typeof record.message === "string" ? [record.message] : [],
  );
  if (typeof error === "string") messages.push(error);
  const message = messages.join("\n");
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
    /\brate[ _-]?limit(?:ed|_exceeded)?\b|\bquota[ _-](?:exceeded|exhausted|limit)\b|\binsufficient[ _]quota\b|\b(?:account|usage) (?:usage )?limit\b|\baccount (?:disabled|suspended)\b|\b429\b/i.test(
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
  return "runtime";
}
