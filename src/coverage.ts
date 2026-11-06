import type { ReviewInput } from "./input.ts";
import type { WorkerResult } from "./results.ts";

type PathRecord = ReviewInput["paths"][number];

/** Paths a worker can read as text; binary files and gitlinks carry no source evidence. */
export const readable = (p: PathRecord) =>
  !p.binary && p.oldMode !== "160000" && p.newMode !== "160000";

/** Readable assessed paths not yet named in `examined` (by new or old name). */
export function uncovered(input: ReviewInput, examined: readonly string[]) {
  const seen = new Set(examined);
  return input.paths
    .filter(readable)
    .filter((p) => !seen.has(p.path) && !(p.oldPath && seen.has(p.oldPath)))
    .map((p) => p.path);
}

/**
 * Folds one focused pass into the aspect's accumulated result. Coverage only grows;
 * established findings are kept. A clean status is certified by the coordinator
 * from coverage, never by a single pass's self-reported status.
 */
export function mergePass(
  input: ReviewInput,
  prior: WorkerResult | null,
  pass: WorkerResult,
  earlierApplicable = false,
): WorkerResult {
  const examined = [
    ...new Set([
      ...(prior?.examinedPaths ?? []),
      ...(pass.examinedPaths ?? []),
    ]),
  ];
  // A focused pass may restate an earlier finding verbatim; keep one copy.
  const seen = new Set<string>();
  const findings = [...(prior?.findings ?? []), ...pass.findings].filter(
    (f) => !seen.has(JSON.stringify(f)) && Boolean(seen.add(JSON.stringify(f))),
  );
  // A08's rubric decides applicability from the task's feature scope, not from files.
  const taskScoped =
    pass.aspect === "A08" &&
    pass.status === "not-applicable" &&
    !earlierApplicable;
  const missing = taskScoped ? [] : uncovered(input, examined);
  const merged: WorkerResult = {
    aspect: pass.aspect,
    status:
      missing.length || pass.status === "incomplete"
        ? "incomplete"
        : findings.length
          ? "findings"
          : pass.status === "not-applicable" && !earlierApplicable
            ? "not-applicable"
            : "no-findings",
    findings,
    limitations: [],
    examinedPaths: examined,
  };
  // A not-applicable reason from one focused pass must not describe a whole
  // aspect that earlier passes found applicable.
  const reason = pass.reason ?? prior?.reason;
  if (reason && ["not-applicable", "incomplete"].includes(merged.status))
    merged.reason = reason;
  if (missing.length) {
    const shown = missing.slice(0, 20).join(", ");
    const more = missing.length > 20 ? ` and ${missing.length - 20} more` : "";
    merged.limitations.push(
      `Unexamined assessed paths (${missing.length}): ${shown}${more}.`,
    );
  }
  merged.limitations.push(...pass.limitations);
  return merged;
}

/**
 * True when the pass grew coverage. Findings alone are not progress: a pass can
 * restate earlier findings forever. The first pass always earns one focused pass,
 * which names the paths a clean claim must cover.
 */
export function progressed(prior: WorkerResult | null, next: WorkerResult) {
  return (
    prior === null ||
    (next.examinedPaths?.length ?? 0) > (prior.examinedPaths?.length ?? 0)
  );
}
