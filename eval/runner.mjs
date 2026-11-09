import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { analyzeRecords } from "./analysis.mjs";
import { scoreSample } from "./assert/anchor-match.mjs";
import { validSample } from "./assert/validation.mjs";
import reviewPolicy from "./review-policy.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const configFile = fileURLToPath(
  new URL("promptfooconfig.yaml", import.meta.url),
);

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
  const selected = samples.filter(
    (sample) => sample.split === split && (!family || sample.family === family),
  );
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("limit must be a positive integer.");
  selected.sort((left, right) => {
    const hash = (sample) =>
      createHash("sha256").update(sample.id).digest("hex");
    return hash(left).localeCompare(hash(right));
  });
  const result = selected.slice(0, limit);
  if (!result.length)
    throw new Error("No samples match the selected family/split.");
  return result;
}

export function makeTestSuite(samples, provider, outputDir) {
  const config = parse(readFileSync(configFile, "utf8"));
  const file = (name) => `file://${resolve(root, "eval", name)}`;
  return {
    ...config,
    providers: [provider],
    extensions: [file("journal.mjs")],
    tests: samples.map((sample) => ({
      description: sample.id,
      vars: { sample },
      options: { disableVarExpansion: true },
      metadata: { journal: resolve(outputDir, "records.jsonl") },
      assert: [
        { type: "javascript", value: file("assert/anchor-match.mjs") },
        { type: "javascript", value: file("assert/harm.mjs") },
      ],
    })),
  };
}

export function recordResult(result) {
  const sample = result.testCase.vars.sample;
  /** @type {{sample: object, repeat: number, envelope?: object, error?: string, metrics?: object}} */
  const record = { sample, repeat: result.repeatIndex ?? 0 };
  if (result.response?.output) {
    try {
      record.envelope =
        typeof result.response.output === "string"
          ? JSON.parse(result.response.output)
          : result.response.output;
    } catch {
      record.error = "Provider returned malformed JSON.";
    }
  }
  // promptfoo 0.125.1 uses ResultFailureReason.ASSERT=1 for scored misses,
  // and also puts their explanation in error. Those are training data.
  const executionError =
    result.response?.error ||
    (result.failureReason !== 1 ? result.error : undefined);
  if (executionError) record.error = executionError;
  if (!record.envelope && !record.error)
    record.error = "Provider returned no evaluation envelope.";
  if (record.envelope && !record.error)
    record.metrics = scoreSample(sample, record.envelope);
  return record;
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
    provider,
    providerConfig = {},
  } = options;
  const plan = planEvaluation(samples, { repeat, budget });
  if (!allowModels) throw new Error("Model execution requires --allow-models.");
  if (!model) throw new Error("Pass the exact Haiku model ID with --model.");
  if (agent !== "claude" || !/^claude-haiku-[\w-]+$/.test(model))
    throw new Error(
      "Evaluation uses the owner's fixed Claude Haiku recommendation.",
    );
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("concurrency must be a positive integer.");
  validateSamples(samples);
  if (!outputDir) throw new Error("A new local output directory is required.");
  mkdirSync(dirname(resolve(outputDir)), { recursive: true });
  mkdirSync(outputDir, { mode: 0o700 });
  process.env.PROMPTFOO_DISABLE_TELEMETRY = "1";
  process.env.PROMPTFOO_CONFIG_DIR ??= resolve(
    root,
    "eval/.generated/promptfoo",
  );
  const configuredProvider = provider ?? {
    id: `file://${resolve(root, "eval/provider.mjs")}`,
    label: "degreaser-haiku",
    config: {
      ...providerConfig,
      productDir: resolve(productDir),
      agent,
      model,
      budgetFile: resolve(outputDir, "admissions.json"),
      sessionBudget: budget,
    },
  };
  const suite = makeTestSuite(samples, configuredProvider, outputDir);
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
  // Save a native promptfoo config so its --resume/--retry-errors own recovery.
  if (!provider)
    writeFileSync(
      resolve(outputDir, "promptfooconfig.json"),
      JSON.stringify(
        {
          ...suite,
          evaluateOptions: {
            repeat,
            maxConcurrency: concurrency,
            cache: false,
          },
        },
        null,
        2,
      ),
    );
  // Promptfoo's declarations load optional database drivers; keep that JS-only
  // dependency outside the product's strict TypeScript program.
  const library = "promptfoo";
  const { evaluate } = await import(library);
  const evaluation = await evaluate(suite, {
    repeat,
    maxConcurrency: concurrency,
    cache: false,
    showProgressBar: false,
  });
  const summary = await evaluation.toEvaluateSummary();
  const records = summary.results.map(recordResult);
  writeFileSync(
    resolve(outputDir, "records.jsonl"),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  const report = {
    schemaVersion: 1,
    evalId: evaluation.id,
    ...plan,
    manifestHash,
    records: records.length,
    providerErrors: records.filter((r) => r.error).length,
    incompleteRecords: records.filter((r) => !r.metrics?.complete).length,
    assertionFailures: summary.stats.failures,
    ...analyzeRecords(records),
  };
  writeFileSync(
    resolve(outputDir, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
