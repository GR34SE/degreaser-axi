const RESOLVED = ["findings", "no-findings", "not-applicable"];
const INVALID_OUTPUT = ["invalid-output", "output-limit"];
const LIFECYCLE_STOP = [null, "timeout", "deadline"];
const NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function workerQuality(attempt) {
  const cause = attempt?.failure ?? null;
  if (INVALID_OUTPUT.includes(cause)) return true;
  const codes = [attempt?.diagnostic?.code, attempt?.diagnostic?.detailCode];
  return (
    LIFECYCLE_STOP.includes(cause) &&
    !!attempt?.result &&
    !codes.some((code) => NETWORK_CODES.has(String(code).toUpperCase()))
  );
}

export function partialOutcome(data, full) {
  const unresolved = data.coverage.filter(
    (row) => !RESOLVED.includes(row.status),
  );
  if (full.failure || full.stopReason === "cancelled" || !unresolved.length)
    throw new Error(
      "Partial review has no attributable worker outcome; it is not rubric quality evidence.",
    );
  for (const row of unresolved) {
    const attempt = full.execution
      .find((execution) => execution.aspect === row.aspect)
      ?.attempts?.at(-1);
    const cause = attempt?.failure ?? null;
    if (!workerQuality(attempt))
      throw new Error(
        `Review ended partial after ${row.aspect} ${cause ?? "unknown"} failure (recovery: ${attempt?.diagnostic?.recovery ?? "inspect"}); it is not rubric quality evidence.`,
      );
  }
  return "worker-quality-partial";
}
