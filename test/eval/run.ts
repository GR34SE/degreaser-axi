import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deriveDataset, readJsonLines } from "./support/dataset.ts";
import { gate } from "./support/gate.ts";
import { evaluate, MODEL, type ReviewRecord } from "./support/review.ts";

const usage = `pnpm eval derive --output <new-directory>
pnpm eval run --samples <dataset>/samples.jsonl --output <new-directory>
    [--split dev|regression|all] [--repeat 3] [--budget 600] [--concurrency 1]
    [--model ${MODEL}] [--product <checkout>] [--allow-models]
pnpm eval gate --baseline <records.jsonl> --candidate <records.jsonl>
    [--mode non-regression|improvement]
Development-only measurement of review quality. Without --allow-models, run prints the plan and launches nothing.`;

const root = fileURLToPath(new URL("../../", import.meta.url));
const [command, ...args] = process.argv.slice(2);
function invalid(): never {
  console.error(usage);
  process.exit(2);
}
const count = (value: string) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : invalid();
};

if (command === "derive") {
  const { values } = parseArgs({
    args,
    options: { output: { type: "string" } },
  });
  if (!values.output) invalid();
  const samples = deriveDataset(values.output, root);
  console.log(`Wrote ${samples.length} samples to ${values.output}.`);
} else if (command === "run") {
  const { values } = parseArgs({
    args,
    options: {
      samples: { type: "string" },
      output: { type: "string" },
      split: { type: "string", default: "dev" },
      repeat: { type: "string", default: "3" },
      budget: { type: "string", default: "600" },
      concurrency: { type: "string", default: "1" },
      model: { type: "string", default: MODEL },
      product: { type: "string", default: root },
      "allow-models": { type: "boolean", default: false },
    },
  });
  if (!values.samples || !values.output) invalid();
  await evaluate({
    samples: values.samples,
    output: values.output,
    split: values.split,
    repeat: count(values.repeat),
    budget: count(values.budget),
    concurrency: count(values.concurrency),
    model: values.model,
    product: values.product,
    allowModels: values["allow-models"],
  });
} else if (command === "gate") {
  const { values } = parseArgs({
    args,
    options: {
      baseline: { type: "string" },
      candidate: { type: "string" },
      mode: { type: "string", default: "non-regression" },
    },
  });
  const { baseline, candidate, mode } = values;
  if (
    !baseline ||
    !candidate ||
    (mode !== "non-regression" && mode !== "improvement")
  )
    invalid();
  const result = gate(
    readJsonLines<ReviewRecord>(baseline),
    readJsonLines<ReviewRecord>(candidate),
    mode,
  );
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
} else invalid();
