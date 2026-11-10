import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { analyzeRecords: analyze } = await import("../../eval/analysis.mjs");

type Bucket = { anchors: number; hitRate: number | null };
type Row = Record<string, number | null | string | string[]>;
type Analysis = {
  breakdown: Row[];
  missFactors: Record<
    "pathCount" | "fileLength" | "position" | "anchorLength",
    Record<
      | "1"
      | "2-5"
      | "6+"
      | "whole-repository"
      | "<=150"
      | "151-400"
      | ">400"
      | "unknown"
      | "top"
      | "middle"
      | "bottom"
      | "2-4"
      | "5+",
      Bucket
    >
  >;
  evidenceGap: { gap: number | null }[];
  diagnosis: { signal: string }[];
  diagnosisNote: string;
};
const analyzeRecords = (records: object[]): Analysis =>
  analyze(records) as unknown as Analysis;
const { renderSummary } = await import("../../eval/summary.mjs");

type Anchor = { id: string; path: string; lines: [number, number] };
const lines = (count: number) => `${"x\n".repeat(count)}`;

function fixture<T>(files: Record<string, number>, run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "eval-analysis-"));
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, count] of Object.entries(files))
      writeFileSync(join(dir, name), lines(count));
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

const sample = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  family: "self",
  split: "dev",
  aspects: ["a"],
  review: { paths: ["f.ts"] },
  repo: { directory: "/missing" },
  target: { report: [], preserve: [] },
  ...over,
});
const record = (
  s: object,
  repeat: number,
  metrics: Record<string, unknown> = {},
) => ({
  sample: s,
  repeat,
  metrics: {
    complete: true,
    hits: [],
    misses: [],
    preserveHits: [],
    ...metrics,
  },
});
const anchor = (
  id: string,
  path: string,
  start: number,
  end = start,
): Anchor => ({
  id,
  path,
  lines: [start, end],
});
const withReport = (
  id: string,
  report: Anchor[],
  dir: string,
  paths: string[],
) =>
  sample(id, {
    repo: { directory: dir },
    review: { paths },
    target: { report, preserve: [] },
  });

test("buckets follow boundaries and repeats average per anchor", () => {
  fixture({ "a.ts": 150, "b.ts": 151, "c.ts": 400, "d.ts": 401 }, (dir) => {
    const s = withReport(
      "s",
      [
        anchor("A", "a.ts", 1, 1),
        anchor("B", "b.ts", 52, 55),
        anchor("C", "c.ts", 400, 404),
        anchor("D", "d.ts", 268),
      ],
      dir,
      ["a", "b"],
    );
    const result = analyzeRecords([
      record(s, 0, { hits: ["A", "C"] }),
      record(s, 1, { hits: ["A"] }),
    ]).missFactors;
    assert.deepEqual(result.fileLength["<=150"], { anchors: 1, hitRate: 1 });
    assert.deepEqual(result.fileLength["151-400"], {
      anchors: 2,
      hitRate: 0.25,
    });
    assert.deepEqual(result.fileLength[">400"], { anchors: 1, hitRate: 0 });
    assert.equal(result.position.top.anchors, 1);
    assert.equal(result.position.middle.anchors, 2);
    assert.equal(result.position.bottom.anchors, 1);
    assert.deepEqual(result.anchorLength["1"], { anchors: 2, hitRate: 0.5 });
    assert.equal(result.anchorLength["2-4"].anchors, 1);
    assert.equal(result.anchorLength["5+"].anchors, 1);
    assert.equal(result.pathCount["2-5"].anchors, 4);
  });
});

test("path count buckets and whole repository", () => {
  const count = (paths: string[]) => {
    const s = withReport("s", [anchor("A", "f.ts", 1)], "/missing", paths);
    return analyzeRecords([record(s, 0, { hits: ["A"] })]).missFactors
      .pathCount;
  };
  assert.equal(count(["1"])["1"].anchors, 1);
  assert.equal(count(["1", "2", "3", "4", "5"])["2-5"].anchors, 1);
  assert.equal(count(["1", "2", "3", "4", "5", "6"])["6+"].anchors, 1);
  assert.equal(count([])["whole-repository"].anchors, 1);
});

test("incomplete records are excluded from factors, kept in completeness; unreadable files are unknown", () => {
  const s = withReport("s", [anchor("A", "gone.ts", 3)], "/missing", [
    "gone.ts",
  ]);
  const result = analyzeRecords([
    record(s, 0, { hits: ["A"] }),
    record(s, 1, { complete: false }),
  ]);
  assert.deepEqual(result.missFactors.fileLength.unknown, {
    anchors: 1,
    hitRate: 1,
  });
  assert.deepEqual(result.missFactors.position.unknown, {
    anchors: 1,
    hitRate: 1,
  });
  assert.equal(result.missFactors.fileLength["<=150"].anchors, 0);
  assert.equal(result.breakdown[0]?.completeness, 0.5);
});

test("old records without recallPrimary yield nulls", () => {
  const s = sample("s");
  const result = analyzeRecords([record(s, 0, { recall: 0.5 })]);
  assert.equal(result.breakdown[0]?.recallPrimary, null);
  assert.equal(result.evidenceGap[0]?.gap, null);
  assert.equal(result.breakdown[0]?.reportAnchors, 0);
});

test("evidence gap and preserve violation rates", () => {
  const s = sample("s", {
    target: { report: [], preserve: [anchor("P", "f.ts", 1)] },
  });
  const clean = sample("t", {
    target: { report: [], preserve: [anchor("Q", "f.ts", 1)] },
  });
  const result = analyzeRecords([
    record(s, 0, { recall: 1, recallPrimary: 0.5, preserveHits: ["P"] }),
    record(s, 1, { recall: 1, recallPrimary: 0.5, preserveHits: ["P"] }),
    record(s, 2, { recall: 1, recallPrimary: 0.5 }),
    record(clean, 0, { recall: 1, recallPrimary: 0.5, preserveHits: ["Q"] }),
    record(clean, 1, { recall: 1, recallPrimary: 0.5 }),
  ]);
  assert.equal(result.evidenceGap[0]?.gap, 0.5);
  assert.equal(result.breakdown[0]?.preserveViolationRate, 0.5);
  assert.equal(result.breakdown[0]?.preserveAnchors, 2);
  const noPreserve = analyzeRecords([record(sample("n"), 0, { recall: 1 })]);
  assert.equal(noPreserve.breakdown[0]?.preserveViolationRate, null);
});

const signals = (result: { diagnosis: { signal: string }[] }) =>
  result.diagnosis.map((item) => item.signal);

test("evidence gap and rubric rules fire exclusively", () => {
  const gap = (primary: number, recall = 0.9) =>
    analyzeRecords([
      record(sample("s"), 0, { recall, recallPrimary: primary }),
    ]);
  const small = gap(0.81);
  assert.deepEqual(signals(small), []);
  assert.deepEqual(signals(gap(0.79)), ["evidenceGap:self"]);
  assert.deepEqual(signals(gap(0.7, 0.7)), ["recall"]);
  assert.deepEqual(signals(gap(0.8, 0.8)), []);
  assert.match(small.diagnosisNote, /Heuristics/);
});

test("coverage rule needs five anchors per bucket and a 0.15 drop", () => {
  const build = (largeHits: number) =>
    fixture({ "s.ts": 100, "l.ts": 500 }, (dir) => {
      const ids = [1, 2, 3, 4, 5].map((n) => anchor(`S${n}`, "s.ts", n));
      const long = [1, 2, 3, 4, 5].map((n) => anchor(`L${n}`, "l.ts", n));
      const s = withReport("s", [...ids, ...long], dir, ["s.ts"]);
      const hits = [
        ...ids.map((a) => a.id),
        ...long.slice(0, largeHits).map((a) => a.id),
      ];
      return signals(
        analyzeRecords([
          record(s, 0, { recall: 0.9, recallPrimary: 0.9, hits }),
        ]),
      );
    });
  assert.deepEqual(build(5), []);
  assert.deepEqual(build(4), ["hitRateDrop:fileLength:>400"]);
  const few = fixture({ "s.ts": 100, "l.ts": 500 }, (dir) => {
    const s = withReport(
      "s",
      [anchor("S", "s.ts", 1), anchor("L", "l.ts", 1)],
      dir,
      ["s"],
    );
    return signals(
      analyzeRecords([
        record(s, 0, { recall: 0.9, recallPrimary: 0.9, hits: ["S"] }),
      ]),
    );
  });
  assert.deepEqual(few, []);
});

test("preserve over-reporting fires above 0.10 only", () => {
  const s = sample("s", {
    target: { report: [], preserve: [anchor("P", "f.ts", 1)] },
  });
  const flagged = analyzeRecords([
    record(s, 0, { recall: 1, preserveHits: ["P"] }),
  ]);
  assert.deepEqual(signals(flagged), ["preserveViolationRate"]);
  assert.deepEqual(signals(analyzeRecords([record(s, 0, { recall: 1 })])), []);
});

test("renderSummary shows the key numbers", () => {
  const s = sample("s", {
    target: { report: [anchor("A", "f.ts", 1)], preserve: [] },
  });
  const analysis = analyzeRecords([
    record(s, 0, {
      recall: 0.5,
      recallPrimary: 0.25,
      precisionProxy: 0.75,
      hits: [],
    }),
  ]);
  const text = renderSummary({
    records: 7,
    providerErrors: 3,
    incompleteRecords: 2,
    ...analysis,
  });
  for (const expected of [
    "self",
    "0.50",
    "0.25",
    "0.75",
    "1/0",
    "Provider errors: 3",
    "Incomplete records: 2",
    "### pathCount",
    "evidenceGap:self",
    "whole-repository",
  ])
    assert.ok(text.includes(expected), expected);
});
