import { setTimeout } from "node:timers/promises";
import { skippedNote } from "../../../install/startup-context.ts";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import { renderReport } from "../../../report/index.ts";
import type { ReportContext } from "../../../report/types.ts";
import { turnBudgetLimitations } from "../../../review/attempt/session.ts";
import { reviewCommand } from "../../../review/prepare/index.ts";
import {
  ownerRecoveryGuidance,
  processAlive,
} from "../../../state/ownership.ts";
import type { Run, RunTask } from "../../../state/run.ts";
import { observeRun } from "../../../state/status.ts";
import { loadInput, loadLatestRun, loadRun } from "../../../state/store.ts";
import { StateError } from "../../../util/errors.ts";
import type { Factory } from "../../factory.ts";
import { progressFor } from "./progress.ts";

export const identities = (tasks: RunTask[]) =>
  [
    ...new Set(tasks.map((t) => `${t.assignment.agent}/${t.assignment.model}`)),
  ].join(",");

export function selectRun(repository: string, id?: string) {
  if (id) return { run: loadRun(repository, id), skipped: 0 };
  const { run, skipped } = loadLatestRun(repository);
  if (!run)
    throw new StateError(
      "no-history",
      `No review history readable by this version. ${skippedNote(skipped) ?? ""}`.trim(),
    );
  return { run, skipped };
}

export function reportContext(f: Factory, snapshot: Run) {
  const { run, status } = observeRun(snapshot);
  const input = loadInput(run);
  const context: ReportContext = {
    input,
    status,
    now: f.now(),
    unverifiedOwner: Boolean(
      status === "interrupted" && run.owner && processAlive(run.owner.pid),
    ),
    ownerRecovery: ownerRecoveryGuidance(run),
    reviewCommand: reviewCommand(input),
    harnessLimitations: Object.fromEntries(
      AGENTS.map((agent) => [
        agent,
        [
          ...HARNESSES[agent].limitations,
          ...turnBudgetLimitations(agent, input.config.limits.maxTurns),
        ],
      ]),
    ),
  };
  return { run, context };
}

const STOP_GRACE_MS = 60_000;

export async function waitFor(f: Factory, run: Run, seconds: number | null) {
  const progress = progressFor(f, run);
  const limit =
    seconds === null ? Number.POSITIVE_INFINITY : f.now() + seconds * 1000;
  const end = () => Math.min(limit, run.deadline + STOP_GRACE_MS);
  while (observeRun(run).status === "running" && f.now() < end()) {
    await setTimeout(Math.min(100, end() - f.now()));
    run = loadRun(run.repository, run.id);
    progress(run);
  }
  const observed = reportContext(f, run);
  return renderReport(observed.run, observed.context);
}
