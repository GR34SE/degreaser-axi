const RESOLVED = ["findings", "no-findings", "not-applicable"];
const WORKER_QUALITY = new Set([
  "invalid-output",
  "output-limit",
  "timeout",
  "deadline",
]);

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
    if (
      !attempt ||
      (cause === null ? !attempt.result : !WORKER_QUALITY.has(cause))
    )
      throw new Error(
        `Review ended partial after ${row.aspect} ${cause ?? "unknown"} failure (recovery: ${attempt?.diagnostic?.recovery ?? "inspect"}); it is not rubric quality evidence.`,
      );
  }
  return "worker-quality-partial";
}
