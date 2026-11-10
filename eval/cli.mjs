import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AxiError, runAxiCli } from "axi-sdk-js";
import {
  planEvaluation,
  readSamples,
  runEvaluation,
  selectSamples,
} from "./runner.mjs";

const help = `Evaluation development tools (no inference in CI)
  run --samples <jsonl> --model <exact-haiku-id> --output <new-directory>
      [--product <checkout>] [--repeat 3] [--budget 600] [--concurrency 1]
      [--family <name>] [--split dev|regression|all] [--limit <sample-count>]
      [--allow-models] (without this flag, print a plan only)
  derive --output <new-directory>
  gate --baseline <records.jsonl> --candidate <records.jsonl> [--output <json>]
      [--mode non-regression|improvement]
Examples:
  pnpm eval -- --samples <samples.jsonl> --model <haiku-id> --output <new-directory>
  pnpm eval:derive -- --output eval/.generated/datasets
  pnpm eval:gate -- --baseline <base.jsonl> --candidate <candidate.jsonl>`;

function flags(args, options) {
  // The SDK owns dispatch/help/errors, but does not expose a flag parser.
  try {
    return parseArgs({
      args: args[0] === "--" ? args.slice(1) : args,
      options,
      strict: true,
    }).values;
  } catch (error) {
    throw new AxiError(error.message, "invalid-argument", [help]);
  }
}

function required(values, names) {
  for (const name of names) {
    if (!values[name])
      throw new AxiError(`--${name} is required.`, "invalid-argument", [help]);
  }
}

async function run(args) {
  const values = flags(args, {
    samples: { type: "string" },
    model: { type: "string" },
    product: { type: "string" },
    output: { type: "string" },
    repeat: { type: "string", default: "3" },
    budget: { type: "string", default: "600" },
    concurrency: { type: "string", default: "1" },
    "allow-models": { type: "boolean", default: false },
    family: { type: "string" },
    split: { type: "string", default: "dev" },
    limit: { type: "string" },
  });
  required(values, ["samples", "model", "output"]);
  const samples = selectSamples(readSamples(values.samples), {
    family: values.family,
    split: values.split,
    limit: values.limit === undefined ? undefined : Number(values.limit),
  });
  const options = {
    samples,
    outputDir: values.output,
    productDir: values.product,
    model: values.model,
    repeat: Number(values.repeat),
    budget: Number(values.budget),
    concurrency: Number(values.concurrency),
    allowModels: values["allow-models"],
  };
  if (!options.allowModels)
    return {
      mode: "plan-only",
      ...planEvaluation(samples, options),
      help: [
        "Add --allow-models after checking quota. This will launch Haiku workers.",
      ],
    };
  const report = await runEvaluation(options);
  if (report.providerErrors || report.incompleteRecords) process.exitCode = 1;
  return report;
}

async function derive(args) {
  const values = flags(args, { output: { type: "string" } });
  required(values, ["output"]);
  const { deriveDatasets } = await import("./datasets/self.mjs");
  const samples = deriveDatasets({ outputDir: values.output });
  return { samples: samples.length, output: values.output };
}

async function gate(args) {
  const script = fileURLToPath(new URL("gate.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [script, ...args.filter((arg, i) => !(i === 0 && arg === "--"))],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  return {};
}

await runAxiCli({
  description: "Local source-backed evaluation",
  topLevelHelp: help,
  commands: { run, derive, gate },
  home: () => ({
    status:
      "Model execution is opt-in; deterministic replay runs in pnpm test.",
    help: [help],
  }),
  getCommandHelp: () => help,
});
