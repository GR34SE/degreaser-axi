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
import { observedStatus } from "../../../state/status.ts";
import { loadInput, loadRun } from "../../../state/store.ts";
import type { Factory } from "../../factory.ts";

export function reportContext(f: Factory, run: Run): ReportContext {
  const input = loadInput(run);
  const status = observedStatus(run);
  return {
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
}

export async function waitFor(f: Factory, run: Run, seconds: number) {
  const end = f.now() + seconds * 1000;
  while (observedStatus(run) === "running" && f.now() < end) {
    await setTimeout(Math.min(100, end - f.now()));
    run = loadRun(run.repository, run.id);
  }
  return renderReport(run, reportContext(f, run));
}
