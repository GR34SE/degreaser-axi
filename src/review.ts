import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { assertSupportedModels, configNotice, loadConfig } from "./config.ts";
import { recordDismissal } from "./dismissals.ts";
import { assertFresh } from "./freshness.ts";
import { repositoryRoot } from "./git.ts";
import { positiveInteger, prepareReview } from "./input.ts";
import { InputError } from "./input-error.ts";
import { discoverModels } from "./model-discovery.ts";
import { assertNotWorker } from "./native-environment.ts";
import type { ResumeControls } from "./owner.ts";
import {
  admissionLock,
  assertAvailable,
  ownerPath,
  ownerRecoveryGuidance,
  verifyOwner,
} from "./ownership.ts";
import {
  exportRun,
  findings,
  observedStatus,
  renderFinding,
  renderReport,
} from "./report.ts";
import {
  checkHistory,
  createRun,
  loadInput,
  loadRun,
  type Run,
  resolved,
  StateError,
} from "./storage.ts";

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
function nestedGuard() {
  assertNotWorker("start nested reviews or resume runs");
}
async function startOwner(run: Run, controls?: ResumeControls) {
  const owner = spawn(
    process.execPath,
    [...process.execArgv, ownerPath, run.repository, run.id],
    {
      cwd: run.repository,
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      owner.once("error", reject);
      owner.once("exit", () =>
        reject(
          new StateError(
            "owner-failed",
            `Owner admission failed. Use degreaser-axi report ${run.id}.`,
          ),
        ),
      );
      owner.once("message", (message: { code?: string; message?: string }) => {
        if (message.code)
          reject(
            new StateError(
              message.code,
              message.message ?? "Owner admission refused.",
            ),
          );
        else resolve();
      });
      owner.once("spawn", () =>
        owner.send({ controls }, (error) => {
          if (error)
            reject(
              new StateError(
                "owner-failed",
                `Could not deliver owner admission. Use degreaser-axi report ${run.id}.`,
              ),
            );
        }),
      );
    });
  } finally {
    if (owner.connected) owner.disconnect();
    owner.unref();
  }
  return loadRun(run.repository, run.id);
}
export async function review(args: string[], cwd: string) {
  nestedGuard();
  const input = prepareReview(args, cwd);
  const notice = configNotice(loadConfig(input.repository));
  checkHistory(input.repository);
  if (input.status === "no-changes")
    return {
      ...notice,
      status: "no-changes",
      scope: input.scope,
      task: input.task,
      reason:
        "No change was reviewed. No reviewer was started; this is not a repository audit or a model quality verdict.",
    };
  const checked = new Set<string>();
  const versionNotices = new Set<string>();
  for (const assignment of input.workers) {
    const key = JSON.stringify([assignment.agent, assignment.model]);
    if (checked.has(key)) continue;
    const models = await discoverModels(
      assignment,
      input.repository,
      Math.min(120_000, input.config.limits.workerTimeoutSeconds * 1000),
    );
    if (models.versionNotice) versionNotices.add(models.versionNotice);
    assertSupportedModels(
      { assignments: [assignment] },
      models.availableModelIds.map((model) => ({
        agent: assignment.agent,
        model,
      })),
    );
    checked.add(key);
  }
  const run = await startOwner(createRun(input));
  process.stderr.write(
    `run: ${run.id}; workers: ${input.workers.length}; identities: ${[...new Set(input.workers.map((w) => `${w.agent}/${w.model}`))].join(",") || "coordinator-only"}; concurrency: ${input.config.concurrency ?? "all"}; deadline: ${new Date(run.deadline).toISOString()}\n`,
  );
  return {
    ...(await waitFor(run, input.waitSeconds)),
    ...notice,
    ...(versionNotices.size
      ? { nativeVersionNotice: [...versionNotices] }
      : {}),
  };
}

export async function resume(
  id: string,
  values: Record<string, unknown>,
  cwd: string,
) {
  nestedGuard();
  const seconds = waitSeconds(values.wait);
  const controls: ResumeControls = { waitSeconds: seconds };
  for (const [flag, key, maximum] of [
    ["concurrency", "concurrency", Number.MAX_SAFE_INTEGER],
    ["deadline", "deadlineSeconds", 2147483],
  ] as const) {
    const value = values[flag];
    if (value !== undefined) {
      if (typeof value !== "string")
        throw new InputError(`--${flag} requires a positive integer.`);
      controls[key] = positiveInteger(value, `--${flag}`, maximum);
    }
  }
  const run = loadRun(repositoryRoot(cwd), id);
  const input = loadInput(run);
  if (run.status !== "completed") assertAvailable(run);
  assertFresh(run, input);
  const completed = {
    run: id,
    status: "already-completed",
    help: [`degreaser-axi report ${id}`],
  };
  if (run.status === "completed") return completed;
  let resumed: Run;
  try {
    resumed = await startOwner(run, controls);
  } catch (error) {
    if (error instanceof StateError && error.code === "already-completed")
      return completed;
    throw error;
  }
  const unresolved = run.tasks.filter((t) => !resolved(t));
  process.stderr.write(
    `run: ${id}; resume unresolved: ${unresolved.length}; identities: ${[...new Set(unresolved.map((t) => `${t.assignment.agent}/${t.assignment.model}`))].join(",")}; concurrency: ${resumed.executions?.at(-1)?.concurrency ?? "all"}; deadline: ${new Date(resumed.deadline).toISOString()}\n`,
  );
  return waitFor(resumed, seconds);
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
  // Serialize even terminal no-ops with resume's old-state -> new-owner admission.
  let unlock: () => void;
  try {
    unlock = admissionLock(run);
  } catch (error) {
    if (error instanceof StateError && error.code === "run-busy")
      throw new StateError(
        error.code,
        `Cancellation was not applied. ${error.message} After admission finishes, retry degreaser-axi cancel ${id}.`,
      );
    throw error;
  }
  try {
    run = loadRun(run.repository, id);
    if (observedStatus(run) !== "running") return renderReport(run);
    const owner = run.owner;
    if (!owner)
      throw new StateError(
        "owner-unverified",
        `No owner is ready. Run degreaser-axi wait ${id}, then retry degreaser-axi cancel ${id}.`,
      );
    // A live PID alone is not ownership: it may have been reused for another run.
    const verified = verifyOwner(run);
    run = loadRun(run.repository, id);
    if (observedStatus(run) !== "running") return renderReport(run);
    if (
      !verified ||
      run.owner?.pid !== owner.pid ||
      run.owner?.started !== owner.started
    )
      throw new StateError(
        "owner-unverified",
        `Cannot verify the active owner of ${id}; no process was signalled. ${ownerRecoveryGuidance(run)}`,
      );
    try {
      process.kill(owner.pid, "SIGTERM");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw new StateError(
          "environment-blocked",
          `Cannot signal the owner of ${id}. Run cancel from a caller permitted to signal this run; do not change global permissions.`,
        );
    }
  } finally {
    unlock();
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
  if (name === "wait") {
    loadInput(run);
    return waitFor(run, seconds);
  }
  if (name === "report") return renderReport(run, values.full === true);
  if (name === "export") return exportRun(run);
  return renderFinding(run, positionals[0]);
}

export function dismissCommand(
  positionals: string[],
  values: Record<string, unknown>,
  cwd: string,
) {
  assertNotWorker("dismiss findings; the caller decides");
  const reason = typeof values.reason === "string" ? values.reason.trim() : "";
  if (!reason)
    throw new InputError(
      "--reason is required: say why the finding should not be applied.",
    );
  const repository = repositoryRoot(cwd);
  const run = loadRun(
    repository,
    typeof values.run === "string" ? values.run : undefined,
  );
  // Finding IDs are renumbered as aspects finish, so only dismiss settled runs.
  if (observedStatus(run) === "running")
    throw new StateError(
      "run-active",
      `${run.id} is still running and its finding IDs can change. Wait for it, then dismiss from the final report.`,
      [`degreaser-axi wait ${run.id}`],
    );
  const id = positionals[0];
  const finding = findings(run).find((f) => f.id === id);
  if (!finding)
    throw new StateError(
      "finding-not-found",
      `Finding not found in ${run.id}: ${id}. Use degreaser-axi report ${run.id} --full.`,
    );
  const stored = recordDismissal(repository, {
    aspect: finding.aspect,
    path: finding.location.path,
    title: finding.title,
    quote: finding.quote,
    reason,
    dismissedAt: Date.now(),
  });
  return {
    status: "dismissed",
    finding: id,
    run: run.id,
    stored,
    help: [
      "Later reviews of this file pass the dismissal to its reviewers. Edit or delete the stored file to undo it.",
    ],
  };
}
