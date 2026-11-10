import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRecords } from "./analysis.mjs";
import { scoreSample } from "./assert/anchor-match.mjs";
import { validSample } from "./assert/validation.mjs";
import { reviewSample } from "./provider.mjs";
import reviewPolicy from "./review-policy.json" with { type: "json" };
import { renderSummary } from "./summary.mjs";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const root = fileURLToPath(new URL("../", import.meta.url));

export function readSamples(file) {
  const samples = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  if (!samples.length) throw new Error("The sample manifest is empty.");
  validateSamples(samples);
  return samples;
}

function validateSamples(samples) {
  const ids = new Set();
  for (const sample of samples) {
    if (!sample.id || ids.has(sample.id))
      throw new Error(`Missing or duplicate sample ID: ${sample.id}`);
    ids.add(sample.id);
  }
  for (const sample of samples)
    if (
      !validSample(sample) ||
      !isAbsolute(sample.repo?.directory ?? "") ||
      !sample.provenance?.source ||
      !sample.provenance?.revision
    )
      throw new Error(`Invalid sample contract: ${sample.id}`);
}

export function planEvaluation(samples, { repeat = 3, budget = 600 } = {}) {
  if (!Number.isSafeInteger(repeat) || repeat < 1)
    throw new Error("repeat must be a positive integer.");
  if (!Number.isSafeInteger(budget) || budget < 1)
    throw new Error("budget must be a positive integer.");
  const initialSessions =
    samples.reduce((sum, sample) => sum + sample.aspects.length, 0) * repeat;
  const maximumSessions = initialSessions * (reviewPolicy.maxRetries + 1);
  if (!initialSessions || maximumSessions > budget)
    throw new Error(
      `Worst-case worker sessions ${maximumSessions} exceed budget ${budget}.`,
    );
  return {
    samples: samples.length,
    repeat,
    initialSessions,
    maximumSessions,
    budget,
  };
}

export function selectSamples(samples, { family, split = "dev", limit } = {}) {
  const splits = split === "all" ? null : split.split(",");
  const selected = samples.filter(
    (sample) =>
      (!splits || splits.includes(sample.split)) &&
      (!family || sample.family === family),
  );
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("limit must be a positive integer.");
  const hash = (sample) => createHash("sha256").update(sample.id).digest("hex");
  selected.sort((left, right) => hash(left).localeCompare(hash(right)));
  const result = selected.slice(0, limit);
  if (!result.length)
    throw new Error("No samples match the selected family/split.");
  return result;
}

async function evaluate(sample, repeat, review) {
  try {
    const envelope = await review(sample);
    return {
      sample,
      repeat,
      envelope,
      metrics: scoreSample(sample, envelope),
    };
  } catch (error) {
    return {
      sample,
      repeat,
      error: error instanceof Error ? error.message : "Evaluation failed.",
    };
  }
}

export async function runEvaluation(options) {
  const {
    samples,
    outputDir,
    productDir = root,
    model,
    agent = "claude",
    repeat = 3,
    budget = 600,
    concurrency = 1,
    allowModels = false,
    timeoutMs,
    env,
    review = (sample, signal) =>
      reviewSample(sample, {
        productDir: resolve(productDir),
        agent,
        model,
        timeoutMs,
        env,
        signal,
      }),
  } = options;
  validateSamples(samples);
  const plan = planEvaluation(samples, { repeat, budget });
  if (!allowModels) throw new Error("Model execution requires --allow-models.");
  if (agent !== "claude" || model !== HAIKU_MODEL)
    throw new Error(
      `Evaluation uses the owner's fixed Claude Haiku recommendation ${HAIKU_MODEL}.`,
    );
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("concurrency must be a positive integer.");
  if (!outputDir) throw new Error("A new local output directory is required.");
  mkdirSync(dirname(resolve(outputDir)), { recursive: true });
  mkdirSync(outputDir, { mode: 0o700 });
  writeFileSync(
    resolve(outputDir, "samples.jsonl"),
    `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`,
    { mode: 0o600 },
  );
  const manifestHash = createHash("sha256")
    .update(JSON.stringify(samples))
    .digest("hex");
  writeFileSync(
    resolve(outputDir, "manifest.json"),
    JSON.stringify({ ...plan, manifestHash, agent, model }, null, 2),
  );

  const jobs = samples.flatMap((sample) =>
    Array.from({ length: repeat }, (_, index) => [sample, index]),
  );
  const records = new Array(jobs.length);
  const recordsFile = resolve(outputDir, "records.jsonl");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const [sample, repetition] = jobs[index];
      records[index] = controller.signal.aborted
        ? { sample, repeat: repetition, error: "Evaluation interrupted." }
        : await evaluate(sample, repetition, (input) =>
            review(input, controller.signal),
          );
      appendFileSync(recordsFile, `${JSON.stringify(records[index])}\n`, {
        mode: 0o600,
      });
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, worker),
    );
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }

  const report = {
    schemaVersion: 1,
    ...plan,
    manifestHash,
    records: records.length,
    providerErrors: records.filter((record) => record.error).length,
    incompleteRecords: records.filter((record) => !record.metrics?.complete)
      .length,
    ...analyzeRecords(records),
  };
  writeFileSync(
    resolve(outputDir, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(resolve(outputDir, "summary.md"), renderSummary(report));
  return report;
}
