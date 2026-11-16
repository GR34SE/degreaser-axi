import type { AspectId } from "../../modules/aspect/api.ts";
import type {
  Candidate,
  FinderResult,
  Finding,
  VerifierResult,
  WorkerResult,
} from "./types.ts";

const UNVERIFIED = "Unverified findings (";
const UNFINISHED = "This aspect did not finish.";

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
): WorkerResult {
  const known = new Set(result.findings.map(candidateKey));
  return {
    ...result,
    examinedPaths: [
      ...new Set([...(result.examinedPaths ?? []), ...found.examinedPaths]),
    ],
    findings: [
      ...result.findings,
      ...found.findings
        .filter((c) => !known.has(candidateKey(c)))
        .map((c): Finding => ({ ...c, verdict: "unverified" })),
    ],
    limitations: [...result.limitations, ...found.limitations],
    ...(found.reason ? { reason: found.reason } : {}),
  };
}

export function applyVerdicts(
  batch: readonly Finding[],
  verdicts: VerifierResult["verdicts"],
): Finding[] {
  const judged = new Map(verdicts.map((v) => [v.candidate, v]));
  return batch.map((finding, i) => {
    const verdict = judged.get(i + 1);
    if (!verdict) return finding;
    const { action: _action, evidence: _evidence, ...rest } = finding;
    return {
      ...rest,
      verdict: verdict.verdict,
      reason: verdict.reason,
      ...(verdict.verdict === "upheld" && verdict.action
        ? { action: verdict.action }
        : {}),
      ...(verdict.evidence ? { evidence: verdict.evidence } : {}),
    };
  });
}

export const verdictStatus = (findings: readonly Finding[]) =>
  findings.some((f) => f.verdict !== "refuted") ? "findings" : "no-findings";

export function settle(
  result: WorkerResult,
  finderStatus: FinderResult["status"],
): WorkerResult {
  const unverified = result.findings.filter(
    (f) => f.verdict === "unverified",
  ).length;
  const judged = verdictStatus(result.findings);
  const status =
    finderStatus === "incomplete"
      ? "incomplete"
      : judged === "no-findings" &&
          !result.findings.length &&
          finderStatus === "not-applicable"
        ? "not-applicable"
        : judged;
  const prior = result.limitations.filter(
    (l) => !l.startsWith(UNVERIFIED) && l !== UNFINISHED,
  );
  const { reason, ...rest } = result;
  return {
    ...rest,
    status,
    limitations: [
      ...prior,
      ...(unverified
        ? [`${UNVERIFIED}${unverified}): no valid verifier verdict yet.`]
        : []),
      ...(status === "incomplete" && !prior.length ? [UNFINISHED] : []),
    ],
    ...(status === "not-applicable"
      ? {
          reason:
            reason ??
            "The assessed paths contain nothing this aspect is about.",
        }
      : status === "incomplete" && reason
        ? { reason }
        : {}),
  };
}
