import { assertSupportedModels } from "../config/resolve.ts";
import { assertNotWorker } from "../modules/harness/common/isolation.ts";
import { discoverModels } from "../modules/harness/common/models.ts";
import { assertAvailable } from "../state/ownership.ts";
import type { Run } from "../state/run.ts";
import { checkHistory, loadInput } from "../state/store.ts";
import { StateError } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { startOwner } from "./owner/launch.ts";
import { createRun } from "./prepare/create.ts";
import { assertFresh } from "./prepare/freshness.ts";
import type { ResumeControls, ReviewInput } from "./types.ts";

export { cancelReview } from "./owner/cancel.ts";

export async function startReview(runtime: Runtime, input: ReviewInput) {
  assertNotWorker(runtime.env, "start nested reviews or resume runs");
  checkHistory(input.repository);
  if (input.status === "no-changes") return { run: null, versionNotices: [] };
  const checked = new Set<string>();
  const versionNotices = new Set<string>();
  for (const assignment of input.workers) {
    const key = JSON.stringify([assignment.agent, assignment.model]);
    if (checked.has(key)) continue;
    const models = await discoverModels(
      runtime,
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
  return {
    run: await startOwner(runtime, createRun(runtime, input)),
    versionNotices: [...versionNotices],
  };
}

export async function resumeReview(
  runtime: Runtime,
  run: Run,
  controls: ResumeControls,
): Promise<Run | null> {
  assertNotWorker(runtime.env, "start nested reviews or resume runs");
  const input = loadInput(run);
  if (run.status !== "completed") assertAvailable(run);
  assertFresh(runtime, run, input);
  if (run.status === "completed") return null;
  try {
    return await startOwner(runtime, run, controls);
  } catch (error) {
    if (error instanceof StateError && error.code === "already-completed")
      return null;
    throw error;
  }
}
