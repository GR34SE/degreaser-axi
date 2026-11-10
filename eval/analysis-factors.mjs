import { readFileSync } from "node:fs";
import { join } from "node:path";

export const THRESHOLDS = {
  evidenceGap: 0.1,
  coverageDrop: 0.15,
  minBucketAnchors: 5,
  lowRecall: 0.8,
  preserveViolation: 0.1,
};

export const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

export const FACTORS = {
  pathCount: ["1", "2-5", "6+", "whole-repository"],
  fileLength: ["<=150", "151-400", ">400", "unknown"],
  position: ["top", "middle", "bottom", "unknown"],
  anchorLength: ["1", "2-4", "5+"],
};

const pathCountBucket = (count) =>
  count === 0
    ? "whole-repository"
    : count === 1
      ? "1"
      : count <= 5
        ? "2-5"
        : "6+";
const fileLengthBucket = (lines) =>
  lines === null
    ? "unknown"
    : lines <= 150
      ? "<=150"
      : lines <= 400
        ? "151-400"
        : ">400";
const positionBucket = (start, lines) => {
  if (lines === null) return "unknown";
  const share = (start - 1) / lines;
  return share < 1 / 3 ? "top" : share < 2 / 3 ? "middle" : "bottom";
};
const anchorLengthBucket = (length) =>
  length === 1 ? "1" : length <= 4 ? "2-4" : "5+";

function lineCounter() {
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) {
      try {
        cache.set(
          path,
          readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length,
        );
      } catch {
        cache.set(path, null);
      }
    }
    return cache.get(path);
  };
}

export function missFactors(records) {
  const lineCount = lineCounter();
  const bySample = new Map();
  for (const record of records) {
    if (!record.metrics?.complete) continue;
    const rows = bySample.get(record.sample.id) ?? {
      sample: record.sample,
      metrics: [],
    };
    rows.metrics.push(record.metrics);
    bySample.set(record.sample.id, rows);
  }
  const values = Object.fromEntries(
    Object.entries(FACTORS).map(([name, buckets]) => [
      name,
      Object.fromEntries(buckets.map((bucket) => [bucket, []])),
    ]),
  );
  for (const { sample, metrics } of bySample.values()) {
    const pathCount = sample.review?.paths?.length ?? 0;
    for (const anchor of sample.target?.report ?? []) {
      const value = mean(
        metrics.map((row) => Number((row.hits ?? []).includes(anchor.id))),
      );
      const lines = sample.repo?.directory
        ? lineCount(join(sample.repo.directory, anchor.path))
        : null;
      const [start, end] = anchor.lines;
      values.pathCount[pathCountBucket(pathCount)].push(value);
      values.fileLength[fileLengthBucket(lines)].push(value);
      values.position[positionBucket(start, lines)].push(value);
      values.anchorLength[anchorLengthBucket(end - start + 1)].push(value);
    }
  }
  return Object.fromEntries(
    Object.entries(values).map(([name, buckets]) => [
      name,
      Object.fromEntries(
        Object.entries(buckets).map(([bucket, hits]) => [
          bucket,
          { anchors: hits.length, hitRate: mean(hits) },
        ]),
      ),
    ]),
  );
}

export const DIAGNOSIS_NOTE =
  "Heuristics for choosing where to look next, not proof of cause. Thresholds are in THRESHOLDS (eval/analysis-factors.mjs).";

function coverageSignals(factors) {
  const comparisons = [
    ["pathCount", "1", "6+"],
    ["pathCount", "1", "whole-repository"],
    ["fileLength", "<=150", ">400"],
  ];
  const signals = [];
  for (const [factor, smallest, largest] of comparisons) {
    const low = factors[factor][smallest];
    const high = factors[factor][largest];
    if (
      low.anchors < THRESHOLDS.minBucketAnchors ||
      high.anchors < THRESHOLDS.minBucketAnchors
    )
      continue;
    const drop = low.hitRate - high.hitRate;
    if (drop >= THRESHOLDS.coverageDrop)
      signals.push({
        signal: `hitRateDrop:${factor}:${largest}`,
        value: drop,
        suggests:
          "misses grow with review size; look at coverage/budget rather than rubric wording",
      });
  }
  return signals;
}

export function diagnose({
  breakdown,
  evidenceGap,
  missFactors: factors,
  recall,
}) {
  const diagnosis = [];
  for (const row of evidenceGap)
    if (row.gap !== null && row.gap >= THRESHOLDS.evidenceGap)
      diagnosis.push({
        signal: `evidenceGap:${row.family}`,
        value: row.gap,
        suggests:
          "the worker groups findings; measure with evidence-inclusive recall, this is not a detection failure",
      });
  const coverage = coverageSignals(factors);
  diagnosis.push(...coverage);
  const grouped = diagnosis.length > 0;
  if (!grouped && recall !== null && recall < THRESHOLDS.lowRecall)
    diagnosis.push({
      signal: "recall",
      value: recall,
      suggests:
        "no scoring or coverage signal explains the misses; review rubric wording",
    });
  const violations = breakdown
    .map((row) => row.preserveViolationRate)
    .filter((value) => value !== null && value > THRESHOLDS.preserveViolation);
  if (violations.length)
    diagnosis.push({
      signal: "preserveViolationRate",
      value: Math.max(...violations),
      suggests: "the rubric over-reports PRESERVE code",
    });
  return diagnosis;
}
