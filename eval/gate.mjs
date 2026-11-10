import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { scoreSample } from "./assert/anchor-match.mjs";
import { object } from "./assert/validation.mjs";

const MIN_SAMPLES = 8;
const RESAMPLES = 10000;
const MARGIN = -0.03;
const TOLERANCE = 1e-12;

const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
function inputKey(sample) {
  const { directory, ...repo } = sample.repo ?? {};
  return JSON.stringify(canonical({ ...sample, repo }));
}

function readRun(input, side, issues) {
  const rows = Array.isArray(input) ? input : input?.records;
  const run = new Map();
  if (!Array.isArray(rows) || !rows.length) {
    issues.push({ code: "no-records", side });
    return run;
  }
  for (const [row, record] of rows.entries()) {
    const reject = (code, reason) =>
      issues.push({ code, side, row, ...(reason && { reason }) });
    if (
      !object(record) ||
      !object(record.sample) ||
      !Number.isSafeInteger(record.repeat) ||
      record.repeat < 0
    ) {
      reject("invalid-record");
      continue;
    }
    if (record.error) {
      reject("provider-error");
      continue;
    }
    const score = scoreSample(record.sample, record.envelope);
    if (!score.complete && score.reason !== "incomplete-review") {
      reject("invalid-export", score.reason);
      continue;
    }
    const key = JSON.stringify([record.sample.id, record.repeat]);
    if (run.has(key)) {
      reject("duplicate-record");
      continue;
    }
    run.set(key, {
      sample: record.sample,
      repeat: record.repeat,
      meta: record.envelope.meta,
      input: inputKey(record.sample),
      score,
    });
  }
  return run;
}

function pairRuns(baselineInput, candidateInput, issues) {
  const baseline = readRun(baselineInput, "baseline", issues);
  const candidate = readRun(candidateInput, "candidate", issues);
  const pairs = [];
  for (const key of new Set([...baseline.keys(), ...candidate.keys()])) {
    const b = baseline.get(key),
      c = candidate.get(key);
    const at = { sample: (b ?? c).sample.id, repeat: (b ?? c).repeat };
    if (!b || !c) issues.push({ code: "missing-pair", ...at });
    else if (
      b.input !== c.input ||
      ["sampleHash", "agent", "model"].some(
        (field) => b.meta[field] !== c.meta[field],
      )
    )
      issues.push({ code: "mismatched-pair-input-or-model", ...at });
    else pairs.push({ baseline: b, candidate: c });
  }
  return pairs.sort(
    (a, b) =>
      a.baseline.sample.id.localeCompare(b.baseline.sample.id) ||
      a.baseline.repeat - b.baseline.repeat,
  );
}

function sampleUnits(pairs, metric) {
  const bySample = new Map();
  let incomplete = false;
  for (const pair of pairs) {
    const sides = [pair.baseline, pair.candidate];
    if (
      metric !== "completeness" &&
      !sides.every((side) => side.score.complete)
    ) {
      incomplete = true;
      continue;
    }
    const values = sides.map((side) =>
      metric === "completeness"
        ? Number(side.score.complete)
        : side.score[metric],
    );
    if (values.includes(null)) continue;
    const id = pair.baseline.sample.id;
    bySample.set(id, [...(bySample.get(id) ?? []), values]);
  }
  const units = [...bySample.values()].map((rows) => [
    mean(rows.map((row) => row[0])),
    mean(rows.map((row) => row[1])),
  ]);
  return { units, incomplete };
}

function bootstrap(units) {
  let state = 2463534242;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const deltas = [];
  for (let iteration = 0; iteration < RESAMPLES; iteration++) {
    let delta = 0;
    for (let index = 0; index < units.length; index++) {
      const unit = units[Math.floor(random() * units.length)];
      delta += unit[1] - unit[0];
    }
    deltas.push(delta / units.length);
  }
  deltas.sort((a, b) => a - b);
  return [
    deltas[Math.floor(0.025 * (deltas.length - 1))],
    deltas[Math.ceil(0.975 * (deltas.length - 1))],
  ];
}

function compareMetric(pairs, metric) {
  const { units, incomplete } = sampleUnits(pairs, metric);
  const baseline = units.length ? mean(units.map((unit) => unit[0])) : null;
  const candidate = units.length ? mean(units.map((unit) => unit[1])) : null;
  const result = {
    baseline,
    candidate,
    delta: units.length ? candidate - baseline : null,
    interval95: null,
    margin: MARGIN,
    samples: units.length,
    status: "inconclusive",
    improved: false,
  };
  if (!units.length && !incomplete) result.status = "unsupported";
  if (!units.length || incomplete || units.length < MIN_SAMPLES) return result;
  const interval = bootstrap(units);
  result.interval95 = interval;
  result.status =
    interval[0] >= MARGIN - TOLERANCE
      ? "passed"
      : interval[1] < MARGIN
        ? "regressed"
        : "inconclusive";
  result.improved = interval[0] > TOLERANCE;
  return result;
}

function verdict(issues, metrics, mode) {
  const values = Object.values(metrics);
  const nonRegression =
    metrics.recall.status !== "unsupported" &&
    values.every((m) => m.status === "passed" || m.status === "unsupported");
  const improved = nonRegression && values.some((m) => m.improved);
  const pass = nonRegression && (mode !== "improvement" || improved);
  if (issues.length) return { pass: false, improved: false, status: "invalid" };
  const status = pass
    ? "passed"
    : values.some((m) => m.status === "regressed")
      ? "regressed"
      : nonRegression
        ? "not-improved"
        : "inconclusive";
  return { pass, improved, status };
}

export function compareRuns(baseline, candidate, options = {}) {
  const mode = options.mode ?? "non-regression";
  const issues = [];
  if (!["non-regression", "improvement"].includes(mode))
    issues.push({ code: "unsupported-mode" });
  const pairs = pairRuns(baseline, candidate, issues);
  const metrics = {
    recall: compareMetric(pairs, "recall"),
    preserveRate: compareMetric(pairs, "preserveRate"),
    completeness: compareMetric(pairs, "completeness"),
  };
  const identity = (side) => {
    const meta = pairs[0]?.[side].meta;
    return meta
      ? {
          agent: meta.agent,
          model: meta.model,
          productSha: meta.productSha,
        }
      : null;
  };
  return {
    schemaVersion: 2,
    ...verdict(issues, metrics, mode),
    mode,
    runIdentities: {
      baseline: identity("baseline"),
      candidate: identity("candidate"),
    },
    pairedRows: pairs.length,
    issues,
    metrics,
    pairedRecallDeltas: pairs.map(({ baseline: b, candidate: c }) => ({
      sample: b.sample.id,
      family: b.sample.family,
      repeat: b.repeat,
      baseline: b.score.recall,
      candidate: c.score.recall,
      delta:
        b.score.recall === null || c.score.recall === null
          ? null
          : c.score.recall - b.score.recall,
    })),
    method: {
      name: "paired-percentile-bootstrap",
      unit: "sample (mean of its repeats)",
      resamples: RESAMPLES,
      interval: 0.95,
      minimumSamples: MIN_SAMPLES,
      notes: [
        "Intervals bound paired differences of one repository's samples, not other codebases.",
        "Incomplete reviews leave recall and preserve inconclusive; unlabelled preserve is unsupported and does not block.",
      ],
    },
  };
}

function parseRecords(source) {
  try {
    return JSON.parse(source);
  } catch {
    return source
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
}

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        baseline: { type: "string" },
        candidate: { type: "string" },
        output: { type: "string" },
        mode: { type: "string" },
      },
    });
    if (!values.baseline || !values.candidate) throw new Error("arguments");
    const [baseline, candidate] = await Promise.all(
      [values.baseline, values.candidate].map(async (file) =>
        parseRecords(await readFile(file, "utf8")),
      ),
    );
    const report = compareRuns(baseline, candidate, { mode: values.mode });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (values.output) await writeFile(values.output, output, { mode: 0o600 });
    process.stdout.write(output);
    process.exitCode = report.pass ? 0 : 1;
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 2,
        pass: false,
        status: "invalid",
        issues: [{ code: "invalid-arguments-or-input-file" }],
      })}\n`,
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
