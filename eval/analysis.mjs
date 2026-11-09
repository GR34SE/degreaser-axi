const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

export function analyzeRecords(records) {
  const groups = new Map();
  const misses = new Map();
  for (const record of records) {
    const { sample, metrics, repeat } = record;
    const key = JSON.stringify([sample.family, sample.aspects.toSorted()]);
    const group = groups.get(key) ?? new Map();
    const rows = group.get(sample.id) ?? [];
    rows.push(metrics);
    group.set(sample.id, rows);
    groups.set(key, group);
    for (const id of metrics?.misses ?? []) {
      const key = JSON.stringify([sample.id, id]);
      const repetitions = misses.get(key) ?? new Set();
      repetitions.add(repeat);
      misses.set(key, repetitions);
    }
  }
  const breakdown = [...groups].map(([key, samples]) => {
    const [family, aspects] = JSON.parse(key);
    const values = [...samples.values()];
    const metric = (name) =>
      mean(
        values
          .map((rows) =>
            mean(rows.map((row) => row?.[name]).filter(Number.isFinite)),
          )
          .filter(Number.isFinite),
      );
    return {
      family,
      aspects,
      samples: samples.size,
      recall: metric("recall"),
      precisionProxy: metric("precisionProxy"),
      preserveRate: metric("preserveRate"),
      completeness: mean(
        values.map((rows) =>
          mean(rows.map((row) => Number(Boolean(row?.complete)))),
        ),
      ),
    };
  });
  const systematicMisses = [...misses]
    .filter(([, repetitions]) => repetitions.size >= 2)
    .map(([key, repetitions]) => {
      const [sampleId, anchorId] = JSON.parse(key);
      return { sampleId, anchorId, missedRepeats: repetitions.size };
    });
  return { breakdown, systematicMisses };
}
