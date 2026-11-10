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

const RANGE = "(\\d+)(?:\\s*(?:-|\u2013|\u2014|to)\\s*(\\d+))?(?!\\d)";
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

export const MAX_LOCATION_SPAN = 30;

export function matchesAnchor(finding, anchor, aspects, evidence = true) {
  const accepted = anchor.aspects ?? aspects;
  if (!accepted.includes(finding.aspect)) return false;
  const side = anchor.side ?? "new";
  const locations = evidence
    ? [finding, ...citations(finding, anchor.path), ...proseLocations(finding)]
    : [finding];
  // A location must intersect the labelled span and stay short; an uncapped
  // whole-file finding would otherwise collect every label in that file.
  return locations.some(
    (location) =>
      location.path === anchor.path &&
      location.side === side &&
      Number.isSafeInteger(location.startLine) &&
      Number.isSafeInteger(location.endLine) &&
      location.startLine <= location.endLine &&
      location.endLine - location.startLine + 1 <= MAX_LOCATION_SPAN &&
      location.startLine <= anchor.lines[1] &&
      location.endLine >= anchor.lines[0],
  );
}

export function uniqueFindings(findings) {
  const seen = new Set();
  const unique = [],
    duplicates = [];
  for (const finding of findings) {
    const { id, group, ...content } = finding;
    const key = JSON.stringify(
      Object.keys(content)
        .sort()
        .map((field) => [field, content[field]]),
    );
    if (seen.has(key)) duplicates.push(id);
    else {
      seen.add(key);
      unique.push(finding);
    }
  }
  return { unique, duplicates };
}

export function forbiddenHits(sample, findings) {
  return sample.target.forbidden
    .filter((sentinel) =>
      findings.some(
        (finding) =>
          (!sentinel.path ||
            finding.path === sentinel.path ||
            citations(finding, sentinel.path).length > 0) &&
          finding.recommendation
            .toLowerCase()
            .includes(sentinel.pattern.toLowerCase()),
      ),
    )
    .map((sentinel) => sentinel.id);
}
