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

export function matchesAnchor(finding, anchor, aspects) {
  const accepted = anchor.aspects ?? aspects;
  if (!accepted.includes(finding.aspect)) return false;
  const side = anchor.side ?? "new";
  const locations = [finding, ...citations(finding, anchor.path)];
  // A citation must be localized inside the labelled span. Mere overlap lets
  // one whole-file finding collect every label in that file.
  return locations.some(
    (location) =>
      location.path === anchor.path &&
      location.side === side &&
      Number.isSafeInteger(location.startLine) &&
      Number.isSafeInteger(location.endLine) &&
      location.startLine <= location.endLine &&
      location.startLine >= anchor.lines[0] &&
      location.endLine <= anchor.lines[1],
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
