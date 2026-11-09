import { hash } from "./gate-pairs.mjs";

export const METRICS = {
  recall: { margin: -0.03, direction: "higher" },
  precisionProxy: { margin: -0.05, direction: "higher" },
  preserveRate: { margin: -0.03, direction: "higher" },
  completeness: { margin: -0.03, direction: "higher" },
  sessions: { margin: 0.15, direction: "lower", relative: true },
  duration: { margin: 0.15, direction: "lower", relative: true },
};
const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function value(row, metric) {
  if (metric === "completeness") return Number(row.score.complete);
  if (metric === "sessions") return row.envelope.meta.sessionCount;
  if (metric === "duration") return row.envelope.meta.durationMs;
  return row.score[metric];
}

function clusterValues(pairs, metric) {
  const clusters = new Map();
  const excluded = [];
  for (const pair of pairs) {
    const baseline = value(pair.baseline, metric),
      candidate = value(pair.candidate, metric);
    if (baseline === null || candidate === null) {
      excluded.push({
        sampleKey: pair.sampleKey,
        repeat: pair.repeat,
        reason: "undefined-denominator",
        asymmetric: (baseline === null) !== (candidate === null),
      });
      continue;
    }
    if (!clusters.has(pair.cluster)) clusters.set(pair.cluster, new Map());
    const samples = clusters.get(pair.cluster);
    if (!samples.has(pair.sampleKey)) samples.set(pair.sampleKey, []);
    samples.get(pair.sampleKey).push([baseline, candidate]);
  }
  return {
    values: [...clusters.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, samples]) => {
        const values = [...samples.values()].map((repeats) => [
          mean(repeats.map((r) => r[0])),
          mean(repeats.map((r) => r[1])),
        ]);
        return [mean(values.map((v) => v[0])), mean(values.map((v) => v[1]))];
      }),
    excluded,
  };
}

function difference(baseline, candidate, relative) {
  return relative
    ? baseline > 0
      ? (candidate - baseline) / baseline
      : null
    : candidate - baseline;
}

function bootstrap(values, relative, seed) {
  let state = Number.parseInt(hash(seed).slice(0, 8), 16) || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const deltas = [];
  for (let iteration = 0; iteration < 10000; iteration++) {
    let baseline = 0,
      candidate = 0;
    for (let index = 0; index < values.length; index++) {
      const pair = values[Math.floor(random() * values.length)];
      baseline += pair[0];
      candidate += pair[1];
    }
    const delta = difference(
      baseline / values.length,
      candidate / values.length,
      relative,
    );
    if (delta === null) return null;
    deltas.push(delta);
  }
  deltas.sort((a, b) => a - b);
  return [
    deltas[Math.floor(0.025 * (deltas.length - 1))],
    deltas[Math.ceil(0.975 * (deltas.length - 1))],
  ];
}

export function compareMetric(pairs, metric, family) {
  const policy = METRICS[metric];
  const { values, excluded } = clusterValues(pairs, metric);
  const baseline = values.length ? mean(values.map((v) => v[0])) : null;
  const candidate = values.length ? mean(values.map((v) => v[1])) : null;
  const delta = values.length
    ? difference(baseline, candidate, policy.relative)
    : null;
  const result = {
    baseline,
    candidate,
    delta,
    interval95: null,
    margin: policy.margin,
    direction: policy.direction,
    relative: policy.relative ?? false,
    clusters: values.length,
    excludedRows: excluded,
    pass: false,
    status: "unsupported",
    improved: false,
  };
  if (!values.length || delta === null) return result;
  result.status = "inconclusive";
  if (values.length < 2 || excluded.some((row) => row.asymmetric))
    return result;
  const interval = bootstrap(values, policy.relative, [family, metric]);
  if (!interval) return result;
  result.interval95 = interval;
  const tolerance = 1e-12;
  result.pass =
    policy.direction === "higher"
      ? interval[0] >= policy.margin - tolerance
      : interval[1] <= policy.margin + tolerance;
  result.status = result.pass
    ? "passed"
    : (
          policy.direction === "higher"
            ? interval[1] < policy.margin
            : interval[0] > policy.margin
        )
      ? "regressed"
      : "inconclusive";
  result.improved = policy.direction === "higher" && interval[0] > tolerance;
  return result;
}
