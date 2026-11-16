import { unsupportedModel } from "../config/resolve.ts";
import type { Identity } from "../config/types.ts";
import { assertNotWorker } from "../modules/harness/common/isolation.ts";
import {
  discoverModels,
  modelChoices,
} from "../modules/harness/common/models.ts";
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
  const selections = new Map<string, string>();
  const versionNotices = new Set<string>();
  const admitted: Identity[] = input.workers.length
    ? [...input.workers, input.config.verifier]
    : [];
  for (const assignment of admitted) {
    const key = JSON.stringify([assignment.agent, assignment.model]);
    if (selections.has(key)) continue;
    const models = await discoverModels(
      runtime,
      assignment,
      input.repository,
      Math.min(120_000, input.config.limits.workerTimeoutSeconds * 1000),
    );
    if (models.versionNotice) versionNotices.add(models.versionNotice);
    const choices = modelChoices(assignment.agent, models.availableModelIds);
    const resolved =
      choices.find((choice) => choice.model === assignment.model)
        ?.resolvedModel ?? assignment.model;
    if (!models.availableModelIds.includes(resolved))
      throw unsupportedModel(assignment, [
        ...new Set([
          ...choices.map((choice) => choice.model),
          ...models.availableModelIds,
        ]),
      ]);
    selections.set(key, resolved);
  }
  const pin = <T extends Identity>(assignment: T): T => {
    const model = selections.get(
      JSON.stringify([assignment.agent, assignment.model]),
    );
    return model && model !== assignment.model
      ? { ...assignment, model, requestedModel: assignment.model }
      : assignment;
  };
  const resolvedInput = {
    ...input,
    config: {
      ...input.config,
      assignments: input.config.assignments.map(pin),
      verifier: pin(input.config.verifier),
    },
    workers: input.workers.map(pin),
  };
  return {
    run: await startOwner(runtime, createRun(runtime, resolvedInput)),
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
