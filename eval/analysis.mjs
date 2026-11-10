import {
  DIAGNOSIS_NOTE,
  diagnose,
  mean,
  missFactors,
} from "./analysis-factors.mjs";

const finite = (values) => values.filter(Number.isFinite);

const sampleMeans = (samples, name) =>
  mean(
    finite(
      [...samples.values()].map((rows) =>
        mean(finite(rows.map((row) => row?.[name]))),
      ),
    ),
  );

function preserveViolationRate(samples, preserveBySample) {
  const flagged = [];
  for (const [id, rows] of samples) {
    if (!preserveBySample.get(id)) continue;
    const scored = rows.filter((row) => row);
    if (!scored.length) continue;
    const counts = new Map();
    for (const row of scored)
      for (const anchor of row.preserveHits ?? [])
        counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
    flagged.push(
      Number([...counts.values()].some((count) => count > scored.length / 2)),
    );
  }
  return mean(flagged);
}

export function analyzeRecords(records) {
  const groups = new Map();
  const families = new Map();
  const misses = new Map();
  const anchorCounts = new Map();
  for (const record of records) {
    const { sample, metrics, repeat } = record;
    anchorCounts.set(sample.id, [
      sample.target?.report?.length ?? 0,
      sample.target?.preserve?.length ?? 0,
    ]);
    const key = JSON.stringify([
      sample.family,
      sample.split ?? null,
      sample.aspects.toSorted(),
    ]);
    const group = groups.get(key) ?? new Map();
    const rows = group.get(sample.id) ?? [];
    rows.push(metrics);
    group.set(sample.id, rows);
    groups.set(key, group);
    const family = families.get(sample.family) ?? new Map();
    family.set(sample.id, [...(family.get(sample.id) ?? []), metrics]);
    families.set(sample.family, family);
    for (const id of metrics?.misses ?? []) {
      const key = JSON.stringify([sample.id, id]);
      const repetitions = misses.get(key) ?? new Set();
      repetitions.add(repeat);
      misses.set(key, repetitions);
    }
  }
  const preserveBySample = new Map(
    [...anchorCounts].map(([id, counts]) => [id, counts[1] > 0]),
  );
  const breakdown = [...groups].map(([key, samples]) => {
    const [family, split, aspects] = JSON.parse(key);
    const ids = [...samples.keys()];
    const total = (index) =>
      ids.reduce((sum, id) => sum + (anchorCounts.get(id)?.[index] ?? 0), 0);
    return {
      family,
      split,
      aspects,
      samples: samples.size,
      reportAnchors: total(0),
      preserveAnchors: total(1),
      recall: sampleMeans(samples, "recall"),
      recallPrimary: sampleMeans(samples, "recallPrimary"),
      precisionProxy: sampleMeans(samples, "precisionProxy"),
      preserveRate: sampleMeans(samples, "preserveRate"),
      preserveViolationRate: preserveViolationRate(samples, preserveBySample),
      completeness: mean(
        [...samples.values()].map((rows) =>
          mean(rows.map((row) => Number(Boolean(row?.complete)))),
        ),
      ),
    };
  });
  const evidenceGap = [...families].map(([family, samples]) => {
    const recall = sampleMeans(samples, "recall");
    const recallPrimary = sampleMeans(samples, "recallPrimary");
    return {
      family,
      recall,
      recallPrimary,
      gap:
        recall === null || recallPrimary === null
          ? null
          : recall - recallPrimary,
    };
  });
  const factors = missFactors(records);
  const systematicMisses = [...misses]
    .filter(([, repetitions]) => repetitions.size >= 2)
    .map(([key, repetitions]) => {
      const [sampleId, anchorId] = JSON.parse(key);
      return { sampleId, anchorId, missedRepeats: repetitions.size };
    });
  const overallRecall = sampleMeans(
    new Map([...families.values()].flatMap((family) => [...family])),
    "recall",
  );
  return {
    breakdown,
    systematicMisses,
    missFactors: factors,
    evidenceGap,
    diagnosisNote: DIAGNOSIS_NOTE,
    diagnosis: diagnose({
      breakdown,
      evidenceGap,
      missFactors: factors,
      recall: overallRecall,
    }),
  };
}
