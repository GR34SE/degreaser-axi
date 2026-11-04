import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { repositoryRoot } from "./git.ts";
import { prepareReview } from "./input.ts";
import { InputError } from "./input-error.ts";
import { findings, observedStatus, renderReport } from "./report.ts";
import { createRun, loadRun, type Run, StateError } from "./storage.ts";

function waitSeconds(value: unknown): number {
  if (value === undefined) return 480;
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value) ||
    +value < 1 ||
    +value > 2147483
  )
    throw new InputError(
      "--wait must be a positive integer no greater than 2147483.",
    );
  return +value;
}
async function waitFor(run: Run, seconds: number) {
  const end = Date.now() + seconds * 1000;
  while (observedStatus(run) === "running" && Date.now() < end) {
    await setTimeout(Math.min(100, end - Date.now()));
    run = loadRun(run.repository, run.id);
  }
  return renderReport(run);
}
export async function review(args: string[], cwd: string) {
  if (process.env.DEGREASER_WORKER === "1")
    throw new StateError(
      "nested-review",
      "Workers cannot start nested reviews.",
    );
  const input = prepareReview(args, cwd);
  if (input.status === "no-changes")
    return {
      status: "no-changes",
      scope: input.scope,
      task: input.task,
      reason:
        "No change was reviewed. No reviewer was started; this is not a repository audit or a model quality verdict.",
    };
  const run = createRun(input);
  const owner = spawn(
    process.execPath,
    [
      ...process.execArgv,
      fileURLToPath(new URL("../bin/run-owner.js", import.meta.url)),
      run.repository,
      run.id,
    ],
    {
      cwd: run.repository,
      detached: true,
      stdio: "ignore",
    },
  );
  await new Promise<void>((resolve, reject) => {
    owner.once("spawn", resolve);
    owner.once("error", reject);
  });
  owner.unref();
  process.stderr.write(
    `run: ${run.id}; workers: ${input.workers.length}; identities: ${[...new Set(input.workers.map((w) => `${w.agent}/${w.model}`))].join(",") || "coordinator-only"}; concurrency: ${input.config.concurrency ?? "all"}; deadline: ${new Date(run.deadline).toISOString()}\n`,
  );
  return waitFor(run, input.waitSeconds);
}
export async function readCommand(
  name: string,
  positionals: string[],
  values: Record<string, unknown>,
  cwd: string,
) {
  const seconds = name === "wait" ? waitSeconds(values.wait) : 0;
  const run = loadRun(
    repositoryRoot(cwd),
    name === "finding"
      ? typeof values.run === "string"
        ? values.run
        : undefined
      : positionals[0],
  );
  if (name === "wait") return waitFor(run, seconds);
  if (name === "report") return renderReport(run, values.full === true);
  const finding = findings(run).find((f) => f.id === positionals[0]);
  if (!finding)
    throw new StateError(
      "finding-not-found",
      `Finding not found in ${run.id}: ${positionals[0]}`,
    );
  return { run: run.id, evidenceLevel: "source-only", ...finding };
}
