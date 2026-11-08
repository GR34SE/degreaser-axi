export type ExecutionFailure =
  | "model-unavailable"
  | "authentication"
  | "network"
  | "rate-limited"
  | "account-disabled"
  | "environment-blocked"
  | "timeout"
  | "cancelled"
  | "runtime";

export const executionCodes: Record<string, ExecutionFailure> = {
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
const httpStatuses: Record<string, ExecutionFailure> = {
  "401": "authentication",
  "429": "rate-limited",
};

export function causeChain(error: unknown) {
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
export function executionFailure(error: unknown): ExecutionFailure {
  const chain = causeChain(error);
  for (const key of ["detailCode", "code"]) {
    for (const record of chain) {
      const code = record[key];
      if (typeof code === "string") {
        const kind = executionCodes[code.toUpperCase()];
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
