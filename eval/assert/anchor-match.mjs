import { exportProblem, parseEnvelope } from "./validation.mjs";

const MAX_LOCATION_SPAN = 30;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function citations(finding, path) {
  const reference = new RegExp(
    "(?:^|[\\s`\"'(\\[])" +
      escapeRegex(path) +
      ":(?:(old|new):)?([1-9]\\d*)(?:-([1-9]\\d*))?(?=$|[\\s`\"'),;\\]]|\\.(?:$|\\s))",
    "g",
  );
  return [...finding.evidence.matchAll(reference)].map((match) => ({
    path,
    side: match[1] ?? finding.side,
    startLine: Number(match[2]),
    endLine: Number(match[3] ?? match[2]),
  }));
}

const RANGE = "(\\d+)(?:\\s*(?:-|–|—|to)\\s*(\\d+))?(?!\\d)";
const SEPARATOR = "(?:\\s*,\\s*and\\s+|\\s*,\\s*|\\s+and\\s+|\\s*&\\s*)";
const PROSE_LIST = new RegExp(
  `\\blines?\\s+${RANGE}(?:${SEPARATOR}${RANGE})*`,
  "gi",
);

function proseLocations(finding) {
  const spans = [];
  for (const list of finding.evidence.matchAll(PROSE_LIST))
    for (const range of list[0].matchAll(new RegExp(RANGE, "g")))
      spans.push({
        path: finding.path,
        side: finding.side,
        startLine: Number(range[1]),
        endLine: Number(range[2] ?? range[1]),
      });
  return spans;
}

function matchesAnchor(finding, anchor, aspects, evidence) {
  if (!(anchor.aspects ?? aspects).includes(finding.aspect)) return false;
  const side = anchor.side ?? "new";
  const locations = evidence
    ? [finding, ...citations(finding, anchor.path), ...proseLocations(finding)]
    : [finding];
  // The span cap stops one whole-file finding from collecting every label in that file.
  return locations.some(
    (location) =>
      location.path === anchor.path &&
      location.side === side &&
      location.startLine <= location.endLine &&
      location.endLine - location.startLine + 1 <= MAX_LOCATION_SPAN &&
      location.startLine <= anchor.lines[1] &&
      location.endLine >= anchor.lines[0],
  );
}

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
      complete: false,
      reason: problem,
      recall: null,
      recallPrimary: null,
      preserveRate: null,
      hits: [],
      misses: [],
      preserveHits: [],
    };
  const { findings } = envelope.export;
  const { report, preserve } = sample.target;
  const hit = (anchors, evidence = true) =>
    anchors
      .filter((anchor) =>
        findings.some((finding) =>
          matchesAnchor(finding, anchor, sample.aspects, evidence),
        ),
      )
      .map((anchor) => anchor.id);
  const hits = hit(report);
  const preserveHits = hit(preserve);
  const share = (count, total) => (total ? count / total : null);
  return {
    complete: true,
    reason: "source-anchor proxy; unlabelled code is unknown",
    recall: share(hits.length, report.length),
    recallPrimary: share(hit(report, false).length, report.length),
    preserveRate: share(preserve.length - preserveHits.length, preserve.length),
    hits,
    misses: report
      .filter((anchor) => !hits.includes(anchor.id))
      .map((anchor) => anchor.id),
    preserveHits,
  };
}
