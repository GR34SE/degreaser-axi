import type { ReviewRecord } from "./review.ts";

const MARGIN = -0.03;
const MIN_SAMPLES = 8;
const RESAMPLES = 10_000;
const TOLERANCE = 1e-12;

type Metric = "recall" | "retention" | "completeness";
type Pair = [ReviewRecord, ReviewRecord];

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function pair(baseline: ReviewRecord[], candidate: ReviewRecord[]) {
  const issues: string[] = [];
  const index = (records: ReviewRecord[], side: string) => {
    const keyed = new Map<string, ReviewRecord>();
    for (const record of records) {
      const key = `${record.sample}#${record.repeat}`;
      if (record.outcome === "error")
        issues.push(`${side} ${key}: ${record.error}`);
      else if (keyed.has(key)) issues.push(`${side} ${key}: duplicate record`);
      else keyed.set(key, record);
    }
    return keyed;
  };
  const before = index(baseline, "baseline");
  const after = index(candidate, "candidate");
  const pairs: Pair[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const c = after.get(key);
    if (!b || !c)
      issues.push(`${key}: missing in ${b ? "candidate" : "baseline"}`);
    else if (b.input !== c.input || b.model !== c.model)
      issues.push(`${key}: different input or model`);
    else pairs.push([b, c]);
  }
  return { pairs, issues };
}

function bootstrap(units: [number, number][]) {
  let state = 2463534242;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const deltas: number[] = [];
  for (let iteration = 0; iteration < RESAMPLES; iteration++) {
    let delta = 0;
    for (let i = 0; i < units.length; i++) {
      const [b = 0, c = 0] = units[Math.floor(random() * units.length)] ?? [];
      delta += c - b;
    }
    deltas.push(delta / units.length);
  }
  deltas.sort((a, b) => a - b);
  return [
    deltas[Math.floor(0.025 * (RESAMPLES - 1))] ?? 0,
    deltas[Math.ceil(0.975 * (RESAMPLES - 1))] ?? 0,
  ] as const;
}

function compare(pairs: Pair[], metric: Metric) {
  const bySample = new Map<string, [number, number][]>();
  let incomplete = false;
  for (const [b, c] of pairs) {
    let values: [number | null, number | null];
    if (metric === "completeness")
      values = [
        Number(b.outcome === "complete"),
        Number(c.outcome === "complete"),
      ];
    else if (b.outcome === "complete" && c.outcome === "complete")
      values = [b[metric], c[metric]];
    else {
      incomplete = true;
      continue;
    }
    const [before, after] = values;
    if (before === null || after === null) continue;
    bySample.set(b.sample, [
      ...(bySample.get(b.sample) ?? []),
      [before, after],
    ]);
  }
  const units = [...bySample.values()].map((rows): [number, number] => [
    mean(rows.map(([b]) => b)),
    mean(rows.map(([, c]) => c)),
  ]);
  const baseline = units.length ? mean(units.map(([b]) => b)) : null;
  const candidate = units.length ? mean(units.map(([, c]) => c)) : null;
  const measured = { baseline, candidate, samples: units.length };
  if (incomplete || units.length < MIN_SAMPLES)
    return {
      ...measured,
      interval95: null,
      status: units.length || incomplete ? "inconclusive" : "unsupported",
      improved: false,
    };
  const [low, high] = bootstrap(units);
  return {
    ...measured,
    interval95: [low, high],
    status:
      low >= MARGIN - TOLERANCE
        ? "passed"
        : high < MARGIN
          ? "regressed"
          : "inconclusive",
    improved: low > TOLERANCE,
  };
}

export function gate(
  baseline: ReviewRecord[],
  candidate: ReviewRecord[],
  mode: "non-regression" | "improvement",
) {
  const { pairs, issues } = pair(baseline, candidate);
  const metrics = {
    recall: compare(pairs, "recall"),
    retention: compare(pairs, "retention"),
    completeness: compare(pairs, "completeness"),
  };
  const statuses = Object.values(metrics).map((m) => m.status);
  const nonRegression =
    metrics.recall.status === "passed" &&
    statuses.every((s) => s === "passed" || s === "unsupported");
  const pass =
    !issues.length &&
    nonRegression &&
    (mode === "non-regression" || metrics.recall.improved);
  const status = issues.length
    ? "invalid"
    : pass
      ? "passed"
      : statuses.includes("regressed")
        ? "regressed"
        : nonRegression
          ? "not-improved"
          : "inconclusive";
  return { status, pass, mode, pairs: pairs.length, issues, metrics };
}
