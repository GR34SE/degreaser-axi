import { readFileSync } from "node:fs";
import { join } from "node:path";

const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const finite = (values) => values.filter(Number.isFinite);
const sampleMean = (samples, read) =>
  mean(finite([...samples.values()].map(read)));
const metricMean = (samples, name) =>
  sampleMean(samples, ({ rows }) =>
    mean(finite(rows.map((row) => row?.[name]))),
  );

const FACTORS = {
  pathCount: ["1", "2-5", "6+", "whole-repository"],
  fileLength: ["<=150", "151-400", ">400", "unknown"],
  position: ["top", "middle", "bottom", "unknown"],
  anchorLength: ["1", "2-4", "5+"],
};

function buckets(pathCount, lines, [start, end]) {
  const share = lines === null ? null : (start - 1) / lines;
  const length = end - start + 1;
  return {
    pathCount:
      pathCount === 0
        ? "whole-repository"
        : pathCount === 1
          ? "1"
          : pathCount <= 5
            ? "2-5"
            : "6+",
    fileLength:
      lines === null
        ? "unknown"
        : lines <= 150
          ? "<=150"
          : lines <= 400
            ? "151-400"
            : ">400",
    position:
      share === null
        ? "unknown"
        : share < 1 / 3
          ? "top"
          : share < 2 / 3
            ? "middle"
            : "bottom",
    anchorLength: length === 1 ? "1" : length <= 4 ? "2-4" : "5+",
  };
}

function lineCount(path) {
  try {
    return readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length;
  } catch {
    return null;
  }
}

function missFactors(records) {
  const bySample = new Map();
  for (const { sample, metrics } of records) {
    if (!metrics?.complete) continue;
    const entry = bySample.get(sample.id) ?? { sample, metrics: [] };
    entry.metrics.push(metrics);
    bySample.set(sample.id, entry);
  }
  const values = Object.fromEntries(
    Object.entries(FACTORS).map(([name, names]) => [
      name,
      Object.fromEntries(names.map((bucket) => [bucket, []])),
    ]),
  );
  const lines = new Map();
  for (const { sample, metrics } of bySample.values())
    for (const anchor of sample.target?.report ?? []) {
      const path = sample.repo?.directory
        ? join(sample.repo.directory, anchor.path)
        : null;
      if (path && !lines.has(path)) lines.set(path, lineCount(path));
      const hitRate = mean(
        metrics.map((row) => Number((row.hits ?? []).includes(anchor.id))),
      );
      const keys = buckets(
        sample.review?.paths?.length ?? 0,
        path ? lines.get(path) : null,
        anchor.lines,
      );
      for (const [factor, bucket] of Object.entries(keys))
        values[factor][bucket].push(hitRate);
    }
  return Object.fromEntries(
    Object.entries(values).map(([name, entries]) => [
      name,
      Object.fromEntries(
        Object.entries(entries).map(([bucket, hits]) => [
          bucket,
          { anchors: hits.length, hitRate: mean(hits) },
        ]),
      ),
    ]),
  );
}

function preserveViolationRate(samples) {
  return sampleMean(samples, ({ sample, rows }) => {
    const scored = rows.filter(Boolean);
    if (!sample.target?.preserve?.length || !scored.length) return null;
    const counts = new Map();
    for (const row of scored)
      for (const anchor of row.preserveHits ?? [])
        counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
    return Number(
      [...counts.values()].some((count) => count > scored.length / 2),
    );
  });
}

function diagnose(breakdown, factors, recall) {
  const diagnosis = [];
  for (const row of breakdown) {
    const gap =
      row.recall === null || row.recallPrimary === null
        ? null
        : row.recall - row.recallPrimary;
    if (gap !== null && gap >= 0.1)
      diagnosis.push({
        signal: `evidenceGap:${row.family}/${row.split ?? "n/a"}`,
        value: gap,
        suggests:
          "the worker groups findings; measure with evidence-inclusive recall, this is not a detection failure",
      });
  }
  for (const [factor, small, large] of [
    ["pathCount", "1", "6+"],
    ["pathCount", "1", "whole-repository"],
    ["fileLength", "<=150", ">400"],
  ]) {
    const low = factors[factor][small],
      high = factors[factor][large];
    if (low.anchors < 5 || high.anchors < 5) continue;
    if (low.hitRate - high.hitRate >= 0.15)
      diagnosis.push({
        signal: `hitRateDrop:${factor}:${large}`,
        value: low.hitRate - high.hitRate,
        suggests:
          "misses grow with review size; look at coverage/budget rather than rubric wording",
      });
  }
  if (!diagnosis.length && recall !== null && recall < 0.8)
    diagnosis.push({
      signal: "recall",
      value: recall,
      suggests:
        "no scoring or coverage signal explains the misses; review rubric wording",
    });
  const violations = finite(breakdown.map((row) => row.preserveViolationRate));
  if (violations.some((value) => value > 0.1))
    diagnosis.push({
      signal: "preserveViolationRate",
      value: Math.max(...violations),
      suggests: "the rubric over-reports PRESERVE code",
    });
  return diagnosis;
}

export function analyzeRecords(records) {
  const groups = new Map();
  const all = new Map();
  const misses = new Map();
  for (const { sample, metrics, repeat } of records) {
    const key = JSON.stringify([
      sample.family,
      sample.split ?? null,
      sample.aspects.toSorted(),
    ]);
    const group = groups.get(key) ?? new Map();
    groups.set(key, group);
    for (const samples of [group, all]) {
      const entry = samples.get(sample.id) ?? { sample, rows: [] };
      entry.rows.push(metrics);
      samples.set(sample.id, entry);
    }
    for (const id of metrics?.misses ?? []) {
      const missKey = JSON.stringify([sample.id, id]);
      misses.set(missKey, (misses.get(missKey) ?? new Set()).add(repeat));
    }
  }
  const breakdown = [...groups].map(([key, samples]) => {
    const [family, split, aspects] = JSON.parse(key);
    const anchors = (kind) =>
      [...samples.values()].reduce(
        (sum, { sample }) => sum + (sample.target?.[kind]?.length ?? 0),
        0,
      );
    return {
      family,
      split,
      aspects,
      samples: samples.size,
      reportAnchors: anchors("report"),
      preserveAnchors: anchors("preserve"),
      recall: metricMean(samples, "recall"),
      recallPrimary: metricMean(samples, "recallPrimary"),
      preserveRate: metricMean(samples, "preserveRate"),
      preserveViolationRate: preserveViolationRate(samples),
      completeness: sampleMean(samples, ({ rows }) =>
        mean(rows.map((row) => Number(Boolean(row?.complete)))),
      ),
    };
  });
  const factors = missFactors(records);
  return {
    breakdown,
    systematicMisses: [...misses]
      .filter(([, repeats]) => repeats.size >= 2)
      .map(([key, repeats]) => {
        const [sampleId, anchorId] = JSON.parse(key);
        return { sampleId, anchorId, missedRepeats: repeats.size };
      }),
    missFactors: factors,
    diagnosis: diagnose(breakdown, factors, metricMean(all, "recall")),
  };
}
