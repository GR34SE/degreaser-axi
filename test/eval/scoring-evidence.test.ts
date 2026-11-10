import assert from "node:assert/strict";
import test from "node:test";
import { scoreSample } from "../../eval/assert/anchor-match.mjs";

function fixture(lines: [number, number][]) {
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
      report: lines.map((range, index) => ({
        id: `r${index + 1}`,
        path: "a.ts",
        lines: range,
        aspects: ["comments"],
      })),
      preserve: [] as { id: string; path: string; lines: number[] }[],
      forbidden: [],
    },
  };
  const finding = {
    id: "F1",
    group: "G1",
    aspect: "comments",
    path: "a.ts",
    side: "new",
    startLine: 500,
    endLine: 500,
    title: "Redundant comment",
    quote: "// comment",
    evidence: "No locations here.",
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

const spread: [number, number][] = [
  [15, 15],
  [84, 84],
  [100, 100],
];

function hitsFor(evidence: string, anchors = spread) {
  const { sample, envelope, finding } = fixture(anchors);
  finding.evidence = evidence;
  return scoreSample(sample, envelope).hits;
}

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

test("a list stops at the first token that is not a number or separator", () => {
  assert.deepEqual(hitsFor("At lines 15 and then 84."), ["r1"]);
});

test("prose lines never credit a different path or side", () => {
  const { sample, envelope, finding } = fixture(spread);
  finding.path = "b.ts";
  finding.evidence = "It recurs at lines 15 and 84.";
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
  finding.path = "a.ts";
  finding.side = "old";
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
});

test("location spans above 30 lines hit nothing; 30 lines still hit", () => {
  const { sample, envelope, finding } = fixture([[10, 12]]);
  finding.startLine = 1;
  finding.endLine = 31;
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
  finding.endLine = 30;
  assert.deepEqual(scoreSample(sample, envelope).hits, ["r1"]);
  finding.startLine = 500;
  finding.endLine = 500;
  finding.evidence = "See lines 1-31.";
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
});

test("intersecting but not contained locations hit", () => {
  const { sample, envelope, finding } = fixture([[10, 20]]);
  finding.startLine = 18;
  finding.endLine = 25;
  const score = scoreSample(sample, envelope);
  assert.deepEqual(score.hits, ["r1"]);
  assert.deepEqual(score.primaryHits, ["r1"]);
  finding.startLine = 21;
  assert.deepEqual(scoreSample(sample, envelope).hits, []);
});

test("recallPrimary counts only primary locations while recall includes evidence", () => {
  const { sample, envelope, finding } = fixture(spread);
  finding.startLine = 15;
  finding.endLine = 15;
  finding.evidence = "Similar at lines 84 and 100.";
  const score = scoreSample(sample, envelope);
  assert.equal(score.recall, 1);
  assert.equal(score.recallPrimary, 1 / 3);
  assert.deepEqual(score.primaryHits, ["r1"]);
  assert.deepEqual(score.hits, ["r1", "r2", "r3"]);
  assert.deepEqual(score.unmatchedFindingIds, []);
});

test("preserve anchors are hit through evidence too", () => {
  const { sample, envelope, finding } = fixture([[15, 15]]);
  sample.target.preserve = [{ id: "p1", path: "a.ts", lines: [60, 62] }];
  finding.evidence = "Also at line 61.";
  const score = scoreSample(sample, envelope);
  assert.deepEqual(score.preserveHits, ["p1"]);
  assert.equal(score.preserveRate, 0);
});

test("invalid exports carry null primary recall and no primary hits", () => {
  const { sample, envelope } = fixture(spread);
  const score = scoreSample(sample, { ...envelope, export: null });
  assert.equal(score.complete, false);
  assert.equal(score.recall, null);
  assert.equal(score.recallPrimary, null);
  assert.deepEqual(score.primaryHits, []);
});

test("recallPrimary is null without report anchors", () => {
  const { sample, envelope } = fixture([]);
  assert.equal(scoreSample(sample, envelope).recallPrimary, null);
});
