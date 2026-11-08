import { setTimeout } from "node:timers/promises";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import { renderReport } from "../../../report/index.ts";
import type { ReportContext } from "../../../report/types.ts";
import { turnBudgetLimitations } from "../../../review/attempt/session.ts";
import { reviewCommand } from "../../../review/prepare/index.ts";
import {
  ownerRecoveryGuidance,
  processAlive,
} from "../../../state/ownership.ts";
import type { Run } from "../../../state/run.ts";
import { observeRun } from "../../../state/status.ts";
import { loadInput, loadRun } from "../../../state/store.ts";
import type { Factory } from "../../factory.ts";

/** Returns the run record its observed status was derived from, for rendering. */
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

export async function waitFor(f: Factory, run: Run, seconds: number) {
  const end = f.now() + seconds * 1000;
  while (observeRun(run).status === "running" && f.now() < end) {
    await setTimeout(Math.min(100, end - f.now()));
    run = loadRun(run.repository, run.id);
  }
  const observed = reportContext(f, run);
  return renderReport(observed.run, observed.context);
}
