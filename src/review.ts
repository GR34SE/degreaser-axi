import { spawn, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertSupportedModels } from "./config.ts";
import { repositoryRoot } from "./git.ts";
import { prepareReview } from "./input.ts";
import { InputError } from "./input-error.ts";
import { discoverModels } from "./model-discovery.ts";
import { findings, observedStatus, renderReport } from "./report.ts";
import {
  checkHistory,
  createRun,
  loadInput,
  loadRun,
  type Run,
  StateError,
} from "./storage.ts";

const ownerPath = fileURLToPath(
  new URL("../bin/run-owner.js", import.meta.url),
);

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
  checkHistory(input.repository);
  if (input.status === "no-changes")
    return {
      status: "no-changes",
      scope: input.scope,
      task: input.task,
      reason:
        "No change was reviewed. No reviewer was started; this is not a repository audit or a model quality verdict.",
    };
  const checked = new Set<string>();
  for (const assignment of input.workers) {
    const key = JSON.stringify([assignment.agent, assignment.model]);
    if (checked.has(key)) continue;
    const models = await discoverModels(
      assignment,
      input.repository,
      Math.min(120_000, input.config.limits.workerTimeoutSeconds * 1000),
    );
    assertSupportedModels(
      { assignments: [assignment] },
      models.availableModelIds.map((model) => ({
        agent: assignment.agent,
        model,
      })),
    );
    checked.add(key);
  }
  const run = createRun(input);
  const owner = spawn(
    process.execPath,
    [...process.execArgv, ownerPath, run.repository, run.id],
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

export async function cancel(id: string | undefined, cwd: string) {
  if (!id) throw new InputError("cancel requires an explicit run ID.");
  let run = loadRun(repositoryRoot(cwd), id);
  loadInput(run);
  // Admission publishes the run before the detached owner publishes its PID.
  const startupEnd = Date.now() + 10_000;
  while (
    observedStatus(run) === "running" &&
    !run.owner &&
    Date.now() < startupEnd
  ) {
    await setTimeout(100);
    run = loadRun(run.repository, id);
  }
  if (observedStatus(run) !== "running") return renderReport(run);
  const owner = run.owner;
  if (!owner)
    throw new StateError(
      "owner-unverified",
      `No owner is ready. Run degreaser-axi wait ${id}.`,
    );
  // A live PID alone is not ownership: it may have been reused for another run.
  const processInfo = spawnSync(
    "/bin/ps",
    ["-ww", "-p", String(owner.pid), "-o", "command="],
    { encoding: "utf8", timeout: 1000 },
  );
  const command = processInfo.stdout?.trim() ?? "";
  run = loadRun(run.repository, id);
  if (observedStatus(run) !== "running") return renderReport(run);
  if (
    processInfo.status !== 0 ||
    !command.startsWith(`${process.execPath} `) ||
    !command.endsWith(` ${ownerPath} ${run.repository} ${id}`) ||
    run.owner?.pid !== owner.pid
  )
    throw new StateError(
      "owner-unverified",
      `Cannot verify the active owner of ${id}; no process was signalled. Run degreaser-axi wait ${id} or use a caller with local process-inspection permission.`,
    );
  try {
    process.kill(owner.pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw new StateError(
        "environment-blocked",
        `Cannot signal the owner of ${id}. Run cancel from a caller permitted to signal this run; do not change global permissions.`,
      );
  }
  // Only the owner writes cancellation/results and joins the worker trees.
  return waitFor(loadRun(run.repository, id), 480);
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
  loadInput(run);
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
