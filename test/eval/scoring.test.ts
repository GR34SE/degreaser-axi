import assert from "node:assert/strict";
import test from "node:test";
import { scoreSample } from "../../eval/assert/anchor-match.mjs";

type Anchor = {
  id: string;
  path: string;
  lines: [number, number];
  aspects?: string[];
};

function fixture(report: [number, number][] = [[3, 4]]) {
  const sample = {
    id: "fixture",
    family: "synthetic",
    split: "dev",
    aspects: ["comments"],
    repo: { directory: "/private/generated" },
    review: { scope: "repository", paths: ["a.ts"], task: "Review comments." },
    target: {
      report: report.map(
        (lines, index): Anchor => ({
          id: `r${index + 1}`,
          path: "a.ts",
          lines,
        }),
      ),
      preserve: [] as Anchor[],
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
  const coverage = {
    aspect: "comments",
    status: "findings",
    rejected: 0,
    examined: "1/1",
    limitations: [] as string[],
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
      coverage: [coverage],
      limitations: [] as string[],
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
  return { sample, envelope, finding, coverage };
}

const spread: [number, number][] = [
  [15, 15],
  [84, 84],
  [100, 100],
];

function hitsFor(evidence: string, anchors = spread) {
  const { sample, envelope, finding } = fixture(anchors);
  finding.startLine = finding.endLine = 500;
  finding.evidence = evidence;
  return scoreSample(sample, envelope).hits;
}

test("scores report and preserve anchors, leaving unlabelled findings unknown", () => {
  const { sample, envelope, finding } = fixture();
  sample.target.preserve = [{ id: "p1", path: "a.ts", lines: [8, 9] }];
  envelope.export.findings.push({
    ...finding,
    id: "F2",
    startLine: 20,
    endLine: 20,
  });
  const score = scoreSample(sample, envelope);
  assert.equal(score.complete, true);
  assert.equal(score.recall, 1);
  assert.equal(score.preserveRate, 1);
  assert.deepEqual(score.hits, ["r1"]);
  assert.deepEqual(score.misses, []);
  finding.evidence = "See a.ts:8 and a.ts:8-9.";
  const flagged = scoreSample(sample, envelope);
  assert.equal(flagged.preserveRate, 0);
  assert.deepEqual(flagged.preserveHits, ["p1"]);
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
    assert.equal(scoreSample(sample, envelope).recall, 0, evidence);
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
});

test("valid findings of an unaccepted aspect do not hit anchors", () => {
  const { sample, envelope } = fixture();
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
});

test("prose line references credit the finding's own path", () => {
  assert.deepEqual(hitsFor("It recurs at line 15."), ["r1"]);
  assert.deepEqual(hitsFor("Comments at lines 15 and 84 repeat it."), [
    "r1",
    "r2",
  ]);
  assert.deepEqual(hitsFor("Also at LINES 15 & 100."), ["r1", "r3"]);
  assert.deepEqual(hitsFor("Seen at lines 15, 84, and 100 too."), [
    "r1",
    "r2",
    "r3",
  ]);
  assert.deepEqual(hitsFor("At lines 15 and then 84."), ["r1"]);
});

test("prose ranges accept hyphen, en dash, em dash and to", () => {
  const anchors: [number, number][] = [
    [40, 40],
    [84, 84],
    [202, 202],
    [120, 120],
  ];
  assert.deepEqual(hitsFor("At lines 38, 82–85, and 201–204.", anchors), [
    "r2",
    "r3",
  ]);
  assert.deepEqual(hitsFor("At lines 82-85 and 118 to 122.", anchors), [
    "r2",
    "r4",
  ]);
  assert.deepEqual(hitsFor("At lines 114—122 shows it.", anchors), ["r4"]);
});

test("numbers not introduced by line or lines are ignored", () => {
  const anchors: [number, number][] = [
    [64, 64],
    [1000, 1000],
    [24, 24],
  ];
  assert.deepEqual(
    hitsFor(
      "Reads 64 MiB, waits 1000 ms, needs Node 24, see 15 and 24.",
      anchors,
    ),
    [],
  );
  assert.deepEqual(hitsFor("Reads at line 64 only, then 1000 ms.", anchors), [
    "r1",
  ]);
});

test("prose lines never credit a different path or side", () => {
  const { sample, envelope, finding } = fixture(spread);
  finding.startLine = finding.endLine = 500;
  finding.path = "b.ts";
  finding.evidence = "It recurs at lines 15 and 84.";
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
  finding.path = "a.ts";
  finding.side = "old";
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
});

test("location spans above 30 lines hit nothing; 30 lines and partial overlap still hit", () => {
  const { sample, envelope, finding } = fixture([[10, 12]]);
  finding.startLine = 1;
  finding.endLine = 31;
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
  envelope.export.findings = [1, 2, 3].map((n) => ({
    ...finding,
    id: `F${n}`,
  }));
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
  envelope.export.findings = [finding];
  finding.endLine = 30;
  assert.deepEqual(scoreSample(sample, envelope).hits, ["r1"]);
  finding.startLine = 12;
  finding.endLine = 20;
  assert.deepEqual(scoreSample(sample, envelope).hits, ["r1"]);
  finding.startLine = 13;
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
  finding.startLine = finding.endLine = 500;
  finding.evidence = "See lines 1-31.";
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
});

test("recallPrimary counts only primary locations while recall includes evidence", () => {
  const { sample, envelope, finding } = fixture(spread);
  finding.startLine = finding.endLine = 15;
  finding.evidence = "Similar at lines 84 and 100.";
  const score = scoreSample(sample, envelope);
  assert.equal(score.recall, 1);
  assert.equal(score.recallPrimary, 1 / 3);
  assert.deepEqual(score.hits, ["r1", "r2", "r3"]);
});

test("empty denominators are unknown, not perfect", () => {
  const { sample, envelope, coverage } = fixture([]);
  envelope.export.findings = [];
  coverage.status = "no-findings";
  const score = scoreSample(sample, envelope);
  assert.equal(score.complete, true);
  assert.equal(score.recall, null);
  assert.equal(score.recallPrimary, null);
  assert.equal(score.preserveRate, null);
});

test("fails closed for malformed and inconsistent public exports", () => {
  const { sample, envelope, coverage } = fixture();
  for (const exported of [
    null,
    {},
    { ...envelope.export, schemaVersion: 2 },
    { ...envelope.export, status: "running" },
    { ...envelope.export, status: "partial" },
    { ...envelope.export, findings: [{}] },
    {
      ...envelope.export,
      findings: [{ ...envelope.export.findings[0], aspect: "other" }],
    },
    { ...envelope.export, coverage: [] },
    { ...envelope.export, coverage: [{ ...coverage, status: "incomplete" }] },
    { ...envelope.export, coverage: [{ ...coverage, rejected: -1 }] },
    { ...envelope.export, coverage: [{ ...coverage, rejected: "1" }] },
    { ...envelope.export, coverage: [{ ...coverage, examined: "0/1" }] },
  ]) {
    const score = scoreSample(sample, { ...envelope, export: exported });
    assert.equal(score.complete, false);
    assert.equal(score.recall, null);
    assert.equal(score.recallPrimary, null);
    assert.deepEqual(score.hits, []);
  }
  assert.equal(scoreSample(sample, { ...envelope, meta: {} }).complete, false);
  assert.equal(
    scoreSample(sample, { ...envelope, error: "failed" }).complete,
    false,
  );
  assert.equal(scoreSample(sample, "not json").reason, "invalid-json");
});

test("a completed export whose rejected quotes were recovered by a later pass is complete", () => {
  const { sample, envelope, coverage } = fixture();
  coverage.rejected = 2;
  const score = scoreSample(sample, envelope);
  assert.equal(score.complete, true);
  assert.deepEqual(score.hits, ["r1"]);
});

test("a well-formed partial review is incomplete evidence, distinct from malformed exports", () => {
  const { sample, envelope, coverage } = fixture();
  const unresolved = { ...coverage, status: "incomplete", examined: "0/1" };
  const partial = {
    ...envelope,
    meta: { ...envelope.meta, outcome: "worker-quality-partial" },
    export: { ...envelope.export, status: "partial", coverage: [unresolved] },
  };
  const score = scoreSample(sample, partial);
  assert.equal(score.complete, false);
  assert.equal(score.reason, "incomplete-review");
  assert.equal(score.recall, null);
  for (const exported of [
    { ...partial.export, coverage: [coverage] },
    { ...partial.export, coverage: [{ ...unresolved, rejected: null }] },
    { ...envelope.export, coverage: [unresolved] },
  ]) {
    const invalid = scoreSample(sample, { ...partial, export: exported });
    assert.equal(invalid.complete, false);
    assert.notEqual(invalid.reason, "incomplete-review");
  }
  const unattributed = scoreSample(sample, { ...partial, meta: envelope.meta });
  assert.equal(unattributed.reason, "unattributed-partial");
  assert.equal(
    scoreSample(sample, { ...partial, sampleId: "other" }).reason,
    "invalid-envelope",
  );
});
