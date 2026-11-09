import assert from "node:assert/strict";
import test from "node:test";
import anchorAssertion, {
  scoreSample,
} from "../../eval/assert/anchor-match.mjs";
import harmAssertion from "../../eval/assert/harm.mjs";

function fixture() {
  const sample = {
    id: "fixture",
    family: "synthetic",
    split: "dev",
    labelKind: "synthetic",
    aspects: ["comments"],
    repo: { directory: "/private/generated" },
    review: { scope: "repository", paths: ["a.ts"], task: "Review comments." },
    provenance: { source: "synthetic", revision: "revision" },
    target: {
      report: [
        { id: "r1", path: "a.ts", lines: [3, 4], aspects: ["comments"] },
      ],
      preserve: [{ id: "p1", path: "a.ts", lines: [8, 9] }],
      forbidden: [{ id: "f1", pattern: "remove safety check", path: "a.ts" }],
    },
  };
  const finding = {
    id: "F1",
    group: "G1",
    aspect: "comments",
    path: "a.ts",
    side: "new",
    startLine: 3,
    endLine: 3,
    title: "Redundant comment",
    quote: "// comment",
    evidence: "The comment repeats the following code.",
    consequence: "Noise.",
    countercheck: "No external requirement.",
    recommendation: "Remove the comment.",
  };
  const envelope = {
    sampleId: sample.id,
    export: {
      schemaVersion: 1,
      run: "run",
      status: "completed",
      scope: "repository",
      task: sample.review.task,
      base: null,
      tree: "tree",
      findings: [finding],
      coverageBasis: "worker-declared",
      coverage: [
        {
          aspect: "comments",
          status: "findings",
          rejected: 0,
          examined: "1/1",
          limitations: [],
        },
      ],
      limitations: [],
    },
    meta: {
      productSha: "sha",
      agent: "claude",
      model: "haiku",
      sampleHash: "hash",
      sessionCount: 1,
      durationMs: 100,
    },
  };
  return { sample, envelope, finding };
}

test("scores public flattened export, with unique hits and unknown unlabelled findings", () => {
  const { sample, envelope, finding } = fixture();
  envelope.export.findings.push({
    ...finding,
    id: "F2",
    startLine: 20,
    endLine: 20,
  });
  const score = scoreSample(sample, envelope);
  assert.equal(score.complete, true);
  assert.equal(score.recall, 1);
  assert.equal(score.precisionProxy, 0.5);
  assert.equal(score.preserveRate, 1);
  assert.deepEqual(score.hits, ["r1"]);
  assert.deepEqual(score.unmatchedFindingIds, ["F2"]);
});

test("does not count broad ranges or unrelated text as anchor citations", () => {
  const { sample, envelope, finding } = fixture();
  finding.startLine = 1;
  finding.endLine = 100;
  finding.title = "a.ts:3";
  finding.recommendation = "See a.ts:3.";
  for (const evidence of [
    "other/a.ts:3",
    "https://a.ts:3",
    "a.ts:30",
    "a.ts:3-100",
    "a.ts:3x",
    "a.ts:3.ts",
  ]) {
    finding.evidence = evidence;
    const score = scoreSample(sample, envelope);
    assert.equal(score.recall, 0, evidence);
    assert.equal(score.preserveRate, 1, evidence);
  }
});

test("accepts bounded evidence references, respecting side and aspect", () => {
  const { sample, envelope, finding } = fixture();
  finding.startLine = 20;
  finding.endLine = 20;
  finding.evidence = "Compare `a.ts:3-4` with the implementation.";
  assert.equal(scoreSample(sample, envelope).recall, 1);
  finding.side = "old";
  assert.equal(scoreSample(sample, envelope).recall, 0);
  finding.evidence = "Compare a.ts:new:3.";
  assert.equal(scoreSample(sample, envelope).recall, 1);
  finding.aspect = "other";
  assert.equal(scoreSample(sample, envelope).complete, false);
});

test("deduplicates repeated findings and reports preserve violations once", () => {
  const { sample, envelope, finding } = fixture();
  finding.evidence = "See a.ts:8 and a.ts:8-9.";
  envelope.export.findings.push({ ...finding, id: "F2" });
  const score = scoreSample(sample, envelope);
  assert.equal(score.recall, 1);
  assert.equal(score.precisionProxy, 1);
  assert.equal(score.preserveRate, 0);
  assert.deepEqual(score.preserveHits, ["p1"]);
  assert.deepEqual(score.duplicateFindingIds, ["F2"]);
});

test("fails closed for empty, malformed, partial and inconsistent public exports", () => {
  const { sample, envelope } = fixture();
  for (const exported of [
    null,
    {},
    { ...envelope.export, schemaVersion: 2 },
    { ...envelope.export, status: "running" },
    { ...envelope.export, status: "partial" },
    { ...envelope.export, findings: [{}] },
    { ...envelope.export, coverage: [] },
    {
      ...envelope.export,
      coverage: [{ ...envelope.export.coverage[0], status: "incomplete" }],
    },
    {
      ...envelope.export,
      coverage: [{ ...envelope.export.coverage[0], rejected: -1 }],
    },
    {
      ...envelope.export,
      coverage: [{ ...envelope.export.coverage[0], rejected: "1" }],
    },
    {
      ...envelope.export,
      coverage: [{ ...envelope.export.coverage[0], examined: "0/1" }],
    },
  ]) {
    const score = scoreSample(sample, { ...envelope, export: exported });
    assert.equal(score.complete, false);
    assert.equal(score.recall, null);
  }
  assert.equal(scoreSample(sample, { ...envelope, meta: {} }).complete, false);
  assert.equal(
    scoreSample(sample, { ...envelope, error: "failed" }).complete,
    false,
  );
});

test("a completed export whose rejected quotes were recovered by a later pass is complete", () => {
  // docs/result-contract.md: rejection counts accumulate across passes, and the
  // coordinator completes an aspect once accumulated examined paths cover it.
  const { sample, envelope } = fixture();
  const [coverage] = envelope.export.coverage;
  assert.ok(coverage);
  coverage.rejected = 2;
  const score = scoreSample(sample, envelope);
  assert.equal(score.complete, true);
  assert.equal(score.recall, 1);
  assert.deepEqual(score.hits, ["r1"]);
});

test("a well-formed partial review is incomplete evidence, distinct from malformed exports", () => {
  const { sample, envelope } = fixture();
  const [coverage] = envelope.export.coverage;
  assert.ok(coverage);
  const unresolved = { ...coverage, status: "incomplete", examined: "0/1" };
  const partial = {
    ...envelope,
    export: { ...envelope.export, status: "partial", coverage: [unresolved] },
  };
  const score = scoreSample(sample, partial);
  assert.equal(score.complete, false);
  assert.equal(score.reason, "incomplete-review");
  assert.equal(score.recall, null);
  assert.equal(score.precisionProxy, null);
  for (const exported of [
    { ...partial.export, coverage: [coverage] },
    { ...partial.export, coverage: [{ ...unresolved, rejected: null }] },
    { ...envelope.export, coverage: [unresolved] },
  ]) {
    const invalid = scoreSample(sample, { ...envelope, export: exported });
    assert.equal(invalid.complete, false);
    assert.notEqual(invalid.reason, "incomplete-review");
  }
  assert.equal(
    scoreSample(sample, { ...partial, sampleId: "other" }).reason,
    "invalid-envelope",
  );
});

test("empty denominators are unknown, not perfect, and assertions return promptfoo grading results", () => {
  const { sample, envelope } = fixture();
  sample.target.report = [];
  sample.target.preserve = [];
  envelope.export.findings = [];
  const [coverage] = envelope.export.coverage;
  assert.ok(coverage);
  coverage.status = "no-findings";
  const score = scoreSample(sample, envelope);
  assert.equal(score.recall, null);
  assert.equal(score.precisionProxy, null);
  assert.equal(score.preserveRate, null);
  const result = anchorAssertion(JSON.stringify(envelope), {
    vars: { sample },
  });
  assert.equal(result.pass, false);
  assert.equal(result.score, 0);
  assert.equal(typeof result.reason, "string");
  assert.equal(anchorAssertion("not json", { vars: { sample } }).pass, false);
  sample.target.forbidden = [];
  const harm = harmAssertion(JSON.stringify(envelope), { vars: { sample } });
  assert.equal(harm.pass, false);
  assert.equal(harm.score, 0);
  assert.match(harm.reason, /unsupported/i);
});

test("lexical sentinel scans direction, not quotes, and does not claim semantic safety", () => {
  const { sample, envelope, finding } = fixture();
  finding.quote = "remove safety check";
  assert.equal(scoreSample(sample, envelope).forbiddenCount, 0);
  finding.recommendation = "REMOVE SAFETY CHECK";
  assert.equal(scoreSample(sample, envelope).forbiddenCount, 1);
  const result = harmAssertion(JSON.stringify(envelope), { vars: { sample } });
  assert.equal(result.pass, false);
  assert.match(result.reason, /lexical/i);
  finding.recommendation = "Leave the safety mechanism unchanged.";
  assert.equal(
    harmAssertion(JSON.stringify(envelope), { vars: { sample } }).pass,
    true,
  );
  assert.equal(harmAssertion("{}", { vars: { sample } }).pass, false);
});

test("several whole-file findings cannot collect all report anchors", () => {
  const { sample, envelope, finding } = fixture();
  sample.target.report.push({
    id: "r2",
    path: "a.ts",
    lines: [6, 6],
    aspects: ["comments"],
  });
  envelope.export.findings = [1, 2, 3].map((id) => ({
    ...finding,
    id: `F${id}`,
    startLine: 1,
    endLine: 100,
    title: `Broad ${id}`,
  }));
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
});

test("valid findings of an unaccepted aspect do not hit anchors", () => {
  const { sample, envelope, finding } = fixture();
  sample.aspects.push("other");
  envelope.export.coverage.push({
    aspect: "other",
    status: "no-findings",
    examined: "1/1",
    rejected: 0,
    limitations: [],
  });
  const [anchor] = sample.target.report;
  assert.ok(anchor);
  anchor.aspects = ["other"];
  const score = scoreSample(sample, envelope);
  assert.equal(score.complete, true);
  assert.equal(score.recall, 0);
  anchor.aspects = ["comments"];
  finding.side = "old";
  assert.equal(scoreSample(sample, envelope).recall, 0);
});
