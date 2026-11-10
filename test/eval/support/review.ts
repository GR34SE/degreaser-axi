import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProjectConfig } from "../../../src/config/types.ts";
import type { Finding } from "../../../src/review/ingest/types.ts";
import { type Run, type RunTask, resolved } from "../../../src/state/run.ts";
import { loadRun } from "../../../src/state/store.ts";
import { stopRuns } from "../../utils/stop-runs.ts";
import { readJsonLines, type Sample } from "./dataset.ts";
import { type Score, score } from "./score.ts";
import { renderSummary, summarize } from "./summary.ts";

export const MODEL = "claude-haiku-4-5-20251001";
const TASK =
  "Audit the selected source for low-value comments. Preserve comments that explain non-obvious constraints, invariants, security boundaries or tradeoffs.";
const WAIT_SECONDS = "960";
const MAX_RETRIES = 1;
const config = (model: string): ProjectConfig => ({
  agent: "claude",
  model,
  maxRetries: MAX_RETRIES,
  limits: {
    workerTimeoutSeconds: 300,
    workerIdleSeconds: 120,
    maxTurns: 40,
    runTimeoutSeconds: 900,
  },
});
const NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

export type ReviewRecord = {
  sample: string;
  repeat: number;
  input: string;
  model: string;
} & (
  | ({ outcome: "complete" } & Score)
  | { outcome: "incomplete" }
  | { outcome: "error"; error: string }
);
export interface EvaluationOptions {
  samples: string;
  split: string;
  repeat: number;
  budget: number;
  concurrency: number;
  output: string;
  product: string;
  model: string;
  allowModels: boolean;
}

async function degreaser(
  cli: string,
  cwd: string,
  args: string[],
  signal: AbortSignal,
) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    signal,
    stdio: "ignore",
  });
  const [code] = await once(child, "close");
  return code;
}

function attributable(attempt: RunTask["attempts"][number] | undefined) {
  const failure = attempt?.failure ?? null;
  if (failure === "invalid-output" || failure === "output-limit") return true;
  const codes = [attempt?.diagnostic?.code, attempt?.diagnostic?.detailCode];
  return (
    (failure === null || failure === "timeout" || failure === "deadline") &&
    Boolean(attempt?.result) &&
    !codes.some((code) => code && NETWORK_CODES.has(code.toUpperCase()))
  );
}

function classify(run: Run, model: string): Finding[] | "incomplete" {
  if (
    run.tasks.some(
      (task) =>
        task.assignment.agent !== "claude" || task.assignment.model !== model,
    )
  )
    throw new Error(`Review did not use claude/${model}.`);
  if (run.status === "completed")
    return run.tasks.flatMap((task) => task.result?.findings ?? []);
  const execution = run.executions?.at(-1);
  if (execution?.failure || execution?.stopReason === "cancelled")
    throw new Error(`Review ended ${run.status} after it was stopped.`);
  for (const task of run.tasks.filter((task) => !resolved(task))) {
    const attempt = task.attempts.at(-1);
    if (run.status !== "partial" || !attributable(attempt))
      throw new Error(
        `Review ended ${run.status} after a ${task.assignment.aspect} ${attempt?.failure ?? "unknown"} failure (recovery: ${attempt?.diagnostic?.recovery ?? "inspect"}).`,
      );
  }
  return "incomplete";
}

async function review(
  cli: string,
  root: string,
  sample: Sample,
  model: string,
  signal: AbortSignal,
) {
  const paths = sample.paths.flatMap((path) => ["--path", path]);
  let code = await degreaser(
    cli,
    root,
    [
      "review",
      "--scope",
      "repository",
      "--task",
      TASK,
      "--aspects",
      "low-value-comments",
      ...paths,
      "--wait",
      WAIT_SECONDS,
    ],
    signal,
  );
  while (code === 3)
    code = await degreaser(
      cli,
      root,
      ["wait", loadRun(root).id, "--wait", WAIT_SECONDS],
      signal,
    );
  return classify(loadRun(root), model);
}

async function reviewCopy(
  cli: string,
  repo: string,
  sample: Sample,
  model: string,
  signal: AbortSignal,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "degreaser-eval-")));
  cpSync(repo, root, { recursive: true });
  writeFileSync(join(root, ".degreaserrc.json"), JSON.stringify(config(model)));
  const result = await review(cli, root, sample, model, signal).catch(
    (error: Error) => error,
  );
  if ((await stopRuns(root, [cli])).length)
    throw new Error(
      `Could not confirm that the review owner exited; its copy remains at ${root}.`,
    );
  rmSync(root, { recursive: true, force: true });
  if (result instanceof Error) throw result;
  return result;
}

export async function evaluate(options: EvaluationOptions) {
  const samples = readJsonLines<Sample>(options.samples).filter(
    (sample) => options.split === "all" || sample.split === options.split,
  );
  if (!samples.length) throw new Error(`No samples in split ${options.split}.`);
  const jobs = samples.flatMap((sample) =>
    Array.from({ length: options.repeat }, (_, repeat) => ({ sample, repeat })),
  );
  const sessions = jobs.length * (MAX_RETRIES + 1);
  console.log(
    `${samples.length} samples x ${options.repeat} repeats = ${jobs.length} reviews, at most ${sessions} worker sessions (budget ${options.budget}).`,
  );
  if (sessions > options.budget)
    throw new Error("The worst-case session count exceeds --budget.");
  if (!options.allowModels) {
    console.log(
      "Plan only. Check quota, then add --allow-models to launch claude workers.",
    );
    return;
  }
  const repo = join(dirname(options.samples), "repo");
  const cli = resolve(options.product, "dist/main.js");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo });
  mkdirSync(dirname(options.output), { recursive: true });
  mkdirSync(options.output);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const measure = ({ sample, repeat }: (typeof jobs)[number]) => {
    const base = {
      sample: sample.id,
      repeat,
      input: createHash("sha256")
        .update(JSON.stringify(sample))
        .update(head)
        .digest("hex"),
      model: options.model,
    };
    return reviewCopy(cli, repo, sample, options.model, controller.signal).then(
      (findings): ReviewRecord =>
        findings === "incomplete"
          ? { ...base, outcome: "incomplete" }
          : { ...base, outcome: "complete", ...score(sample, findings) },
      (error: Error): ReviewRecord => ({
        ...base,
        outcome: "error",
        error: error.name === "AbortError" ? "Interrupted." : error.message,
      }),
    );
  };
  const records: ReviewRecord[] = [];
  const worker = async () => {
    for (
      let job = jobs.shift();
      job && !controller.signal.aborted;
      job = jobs.shift()
    ) {
      const record = await measure(job);
      records.push(record);
      appendFileSync(
        join(options.output, "records.jsonl"),
        `${JSON.stringify(record)}\n`,
      );
      console.log(`${record.sample} #${record.repeat}: ${record.outcome}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: options.concurrency }, worker));
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  const summary = summarize(samples, records, repo);
  writeFileSync(
    join(options.output, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  writeFileSync(join(options.output, "summary.md"), renderSummary(summary));
  console.log(`Wrote ${join(options.output, "summary.md")}.`);
  if (summary.errors || summary.incomplete) process.exitCode = 1;
}
