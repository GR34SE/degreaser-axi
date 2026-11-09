export const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const text = (value) =>
  typeof value === "string" && value.trim().length > 0;
const line = (value) => Number.isSafeInteger(value) && value > 0;
const strings = (value) => Array.isArray(value) && value.every(text);
export const relativePath = (value) =>
  text(value) &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  !value.split("/").some((part) => !part || part === "." || part === "..");
const side = (value) => value === "new" || value === "old";
const range = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(line) &&
  value[0] <= value[1];

function anchor(value) {
  return (
    object(value) &&
    relativePath(value.path) &&
    range(value.lines) &&
    (value.side === undefined || side(value.side)) &&
    (value.aspects === undefined ||
      (strings(value.aspects) && value.aspects.length > 0))
  );
}

export function validSample(sample) {
  if (
    !object(sample) ||
    !text(sample.id) ||
    !text(sample.family) ||
    !strings(sample.aspects) ||
    !sample.aspects.length ||
    new Set(sample.aspects).size !== sample.aspects.length ||
    !object(sample.target) ||
    !object(sample.review) ||
    !["repository", "worktree", "branch"].includes(sample.review.scope) ||
    !text(sample.review.task) ||
    !strings(sample.review.paths) ||
    (sample.review.scope === "branch" && !text(sample.review.base))
  )
    return false;
  const { report, preserve, forbidden } = sample.target;
  if (![report, preserve, forbidden].every(Array.isArray)) return false;
  const ids = [...report, ...preserve, ...forbidden].map((item) => item?.id);
  return (
    ids.every(text) &&
    new Set(ids).size === ids.length &&
    [...report, ...preserve].every(
      (item) =>
        anchor(item) &&
        (item.alsoAccept === undefined ||
          (Array.isArray(item.alsoAccept) &&
            item.alsoAccept.every(
              (alternate) => text(alternate) || anchor(alternate),
            ))),
    ) &&
    forbidden.every(
      (item) =>
        object(item) &&
        text(item.pattern) &&
        (item.path === undefined || relativePath(item.path)),
    )
  );
}

function validFinding(finding, aspects) {
  return (
    object(finding) &&
    text(finding.id) &&
    text(finding.group) &&
    aspects.includes(finding.aspect) &&
    relativePath(finding.path) &&
    side(finding.side) &&
    line(finding.startLine) &&
    line(finding.endLine) &&
    finding.startLine <= finding.endLine &&
    [
      "title",
      "quote",
      "evidence",
      "consequence",
      "countercheck",
      "recommendation",
    ].every((field) => text(finding[field]))
  );
}

function validMeta(meta) {
  return (
    object(meta) &&
    ["sampleHash", "productSha", "agent", "model"].every((key) =>
      text(meta[key]),
    ) &&
    (meta.productHash === undefined ||
      /^[a-f0-9]{64}$/.test(meta.productHash)) &&
    Number.isSafeInteger(meta.sessionCount) &&
    meta.sessionCount >= 0 &&
    Number.isFinite(meta.durationMs) &&
    meta.durationMs >= 0
  );
}

export function exportProblem(sample, envelope) {
  if (!validSample(sample)) return "invalid-sample";
  if (
    !object(envelope) ||
    envelope.sampleId !== sample.id ||
    envelope.error ||
    !validMeta(envelope.meta)
  )
    return "invalid-envelope";
  const data = envelope.export;
  if (
    !object(data) ||
    data.schemaVersion !== 1 ||
    data.status !== "completed" ||
    !text(data.run) ||
    data.coverageBasis !== "worker-declared" ||
    data.scope !== sample.review.scope ||
    data.task !== sample.review.task ||
    !(data.base === null || text(data.base)) ||
    !text(data.tree) ||
    !Array.isArray(data.findings) ||
    !Array.isArray(data.coverage) ||
    !strings(data.limitations)
  )
    return "invalid-or-incomplete-export";
  if (
    !data.findings.every((finding) => validFinding(finding, sample.aspects)) ||
    new Set(data.findings.map((finding) => finding.id)).size !==
      data.findings.length
  )
    return "invalid-findings";
  if (
    data.coverage.length !== sample.aspects.length ||
    new Set(data.coverage.map((row) => row?.aspect)).size !==
      sample.aspects.length
  )
    return "missing-coverage";
  for (const row of data.coverage) {
    if (
      !object(row) ||
      !sample.aspects.includes(row.aspect) ||
      row.rejected !== 0 ||
      !strings(row.limitations) ||
      row.stopCause ||
      row.pending ||
      row.unresolved?.length
    )
      return "invalid-coverage";
    const count = data.findings.filter(
      (finding) => finding.aspect === row.aspect,
    ).length;
    if (row.status === "not-applicable") {
      if (count || !text(row.reason)) return "invalid-coverage";
    } else {
      if (
        !["findings", "no-findings"].includes(row.status) ||
        (row.status === "findings") !== count > 0
      )
        return "incomplete-coverage";
    }
    if (!(row.status === "not-applicable" && row.aspect === "scope-creep")) {
      const examined =
        typeof row.examined === "string" && /^(\d+)\/(\d+)$/.exec(row.examined);
      if (
        !examined ||
        !Number.isSafeInteger(Number(examined[1])) ||
        Number(examined[1]) !== Number(examined[2])
      )
        return "incomplete-coverage";
    }
  }
  return null;
}

export function parseEnvelope(output) {
  return typeof output === "string" ? JSON.parse(output) : output;
}
