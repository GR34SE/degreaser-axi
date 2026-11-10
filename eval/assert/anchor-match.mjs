import { forbiddenHits, matchesAnchor, uniqueFindings } from "./locations.mjs";
import { exportProblem, parseEnvelope } from "./validation.mjs";

export function scoreSample(sample, envelope) {
  let problem;
  try {
    envelope = parseEnvelope(envelope);
    problem = exportProblem(sample, envelope);
  } catch {
    problem = "invalid-json";
  }
  if (problem)
    return {
      recall: null,
      recallPrimary: null,
      precisionProxy: null,
      preserveRate: null,
      forbiddenCount: null,
      complete: false,
      hits: [],
      primaryHits: [],
      misses: [],
      preserveHits: [],
      forbiddenHits: [],
      unmatchedFindingIds: [],
      duplicateFindingIds: [],
      reason: problem,
    };
  const { unique, duplicates } = uniqueFindings(envelope.export.findings);
  const report = sample.target.report;
  const hits = report
    .filter((anchor) =>
      unique.some((finding) => matchesAnchor(finding, anchor, sample.aspects)),
    )
    .map((anchor) => anchor.id);
  const primaryHits = report
    .filter((anchor) =>
      unique.some((finding) =>
        matchesAnchor(finding, anchor, sample.aspects, false),
      ),
    )
    .map((anchor) => anchor.id);
  const unmatched = unique
    .filter(
      (finding) =>
        !report.some((anchor) =>
          matchesAnchor(finding, anchor, sample.aspects),
        ),
    )
    .map((finding) => finding.id);
  const preserve = sample.target.preserve;
  const preserveHits = preserve
    .filter((anchor) =>
      unique.some((finding) => matchesAnchor(finding, anchor, sample.aspects)),
    )
    .map((anchor) => anchor.id);
  const forbidden = forbiddenHits(sample, unique);
  return {
    recall: report.length ? hits.length / report.length : null,
    recallPrimary: report.length ? primaryHits.length / report.length : null,
    precisionProxy: unique.length
      ? (unique.length - unmatched.length) / unique.length
      : null,
    preserveRate: preserve.length
      ? (preserve.length - preserveHits.length) / preserve.length
      : null,
    forbiddenCount: forbidden.length,
    complete: true,
    hits,
    primaryHits,
    misses: report
      .filter((anchor) => !hits.includes(anchor.id))
      .map((anchor) => anchor.id),
    preserveHits,
    forbiddenHits: forbidden,
    unmatchedFindingIds: unmatched,
    duplicateFindingIds: duplicates,
    reason: "source-anchor proxy; unlabelled code is unknown",
  };
}

export default function anchorAssertion(output, context) {
  const score = scoreSample(context?.vars?.sample, output);
  const pass = score.complete && score.recall !== null && score.recall === 1;
  return {
    pass,
    score: score.complete ? (score.recall ?? 0) : 0,
    reason: !score.complete
      ? score.reason
      : score.recall === null
        ? "Recall unsupported: no report anchors; not a perfect score."
        : `Source-anchor recall ${score.recall}; recallPrimary ${score.recallPrimary}; misses=${JSON.stringify(score.misses)}; unmatched=${JSON.stringify(score.unmatchedFindingIds)}; preserveHits=${JSON.stringify(score.preserveHits)}. Precision proxy is not semantic precision.`,
  };
}
