import type { AspectId } from "../../modules/aspect/api.ts";
import type { ReviewInput } from "../types.ts";
import { uncovered } from "./coverage.ts";
import type {
  Candidate,
  FinderResult,
  Finding,
  VerifierResult,
  WorkerResult,
} from "./types.ts";

const UNEXAMINED = "Unexamined assessed paths (";
const UNVERIFIED = "Unverified findings (";

export const emptyResult = (aspect: AspectId): WorkerResult => ({
  aspect,
  status: "incomplete",
  findings: [],
  limitations: [],
  examinedPaths: [],
});

const candidateKey = (c: Candidate) =>
  JSON.stringify([c.location, c.quote, c.title]);

export function mergeFinder(
  result: WorkerResult,
  found: FinderResult,
  shard: readonly string[],
  index: number,
): Finding[] {
  const label = `Shard ${index} (${shard.length} path${shard.length === 1 ? "" : "s"}): `;
  if (found.status !== "incomplete")
    result.examinedPaths = [
      ...new Set([...(result.examinedPaths ?? []), ...shard]),
    ];
  const known = new Set(result.findings.map(candidateKey));
  const added = found.findings
    .filter((c) => !known.has(candidateKey(c)))
    .map((c): Finding => ({ ...c, verdict: "unverified" }));
  result.findings.push(...added);
  if (found.kept?.length) {
    const kept = new Set((result.kept ?? []).map((k) => JSON.stringify(k)));
    result.kept = [
      ...(result.kept ?? []),
      ...found.kept.filter((k) => !kept.has(JSON.stringify(k))),
    ];
  }
  result.limitations.push(...found.limitations.map((l) => `${label}${l}`));
  if (
    found.status === "not-applicable" &&
    found.reason &&
    !result.reason?.includes(found.reason)
  )
    result.reason = result.reason
      ? `${result.reason} ${found.reason}`
      : found.reason;
  return added;
}

export function applyVerdicts(
  batch: Finding[],
  verdicts: VerifierResult["verdicts"],
) {
  for (const { candidate, verdict, reason, action, evidence } of verdicts) {
    const finding = batch[candidate - 1];
    if (!finding) continue;
    finding.verdict = verdict;
    finding.reason = reason;
    if (verdict === "upheld" && action) finding.action = action;
    else delete finding.action;
    if (evidence) finding.evidence = evidence;
    else delete finding.evidence;
  }
}

export function settle(
  input: ReviewInput,
  result: WorkerResult,
  finderStatuses: readonly FinderResult["status"][],
): WorkerResult["status"] {
  const missing = uncovered(input, result.examinedPaths ?? []);
  const unverified = result.findings.filter(
    (f) => f.verdict === "unverified",
  ).length;
  result.limitations = result.limitations.filter(
    (l) => !l.startsWith(UNEXAMINED) && !l.startsWith(UNVERIFIED),
  );
  if (missing.length) {
    const more = missing.length > 20 ? ` and ${missing.length - 20} more` : "";
    result.limitations.unshift(
      `${UNEXAMINED}${missing.length}): ${missing.slice(0, 20).join(", ")}${more}.`,
    );
  }
  if (unverified)
    result.limitations.push(
      `${UNVERIFIED}${unverified}): no valid verifier verdict yet.`,
    );
  result.status =
    missing.length || unverified
      ? "incomplete"
      : result.findings.some((f) => f.verdict === "upheld")
        ? "findings"
        : finderStatuses.every((s) => s === "not-applicable")
          ? "not-applicable"
          : "no-findings";
  if (result.status === "not-applicable")
    result.reason ??= "No assessed path has readable text for this aspect.";
  else if (result.status !== "incomplete") delete result.reason;
  return result.status;
}
