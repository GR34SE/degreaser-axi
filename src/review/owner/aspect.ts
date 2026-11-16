import { join } from "node:path";
import { openFailure, type RunTask } from "../../state/run.ts";
import { errorSummary } from "../../util/error-summary.ts";
import { StateError } from "../../util/errors.ts";
import { executeAttempt } from "../attempt/index.ts";
import {
  assembleFinder,
  assembleFollowUp,
  promptIdentity,
} from "../attempt/prompt/assemble.ts";
import { emptyResult, mergeFinder, settle } from "../ingest/merge.ts";
import type { FinderResult, Rejection, WorkerResult } from "../ingest/types.ts";
import { ingestFinder } from "../ingest/verify-quotes.ts";
import type { OwnerContext } from "./context.ts";
import { VERIFIER, verification } from "./verifier.ts";

function finderStatus(task: RunTask): FinderResult["status"] {
  if (task.status === "incomplete" && task.unresolved?.cause === "owner-failed")
    return "incomplete";
  const last = task.attempts.findLast((a) => a.stage === "find" && a.result);
  return last?.result && !last.failure ? last.result.status : "incomplete";
}

const notesOfOtherStage = (result: WorkerResult, stage: "find" | "verify") =>
  result.limitations.filter(
    (l) => l.startsWith(VERIFIER) !== (stage === "verify"),
  );

const patchFile = (context: OwnerContext) =>
  join(context.dir, "input", "patch.diff");

export async function reviewAspect(context: OwnerContext, task: RunTask) {
  const aspect = task.assignment.aspect;
  const batches = verification(context, task, () => update(context, task));
  const failures: unknown[] = [];
  try {
    if (promptIdentity(aspect) !== task.promptHash)
      throw new StateError(
        "input-changed",
        `Prompt identity for ${aspect} differs from ${join(context.dir, "run.json")}. Start a new review with the current package.`,
      );
    if (finderStatus(task) === "incomplete") {
      const finding = find(context, task, batches.enqueue);
      batches.enqueue();
      await finding;
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    await batches.finish();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    const error = failures[0];
    if (context.control.persistenceError) throw error;
    const cause = error instanceof StateError ? error.code : "owner-failed";
    const message = `Aspect failed (${cause}): ${errorSummary(error)}`;
    task.result = {
      ...(task.result ?? emptyResult(aspect)),
      status: "incomplete",
      limitations: [...(task.result?.limitations ?? []), message],
    };
    task.status = "incomplete";
    task.unresolved = { cause };
    task.limitations.push(message);
    context.control.persist();
    return;
  }
  finish(context, task);
}

async function find(
  context: OwnerContext,
  task: RunTask,
  candidatesReady: () => void,
) {
  const { runtime, input } = context;
  const aspect = task.assignment.aspect;
  let rejections: Rejection[] = [];
  const checkpoint = (value: FinderResult) => {
    const prior = task.result ?? emptyResult(aspect);
    task.result = mergeFinder(
      { ...prior, limitations: notesOfOtherStage(prior, "find") },
      value,
    );
    task.rejections = rejections;
    update(context, task);
    candidatesReady();
    return task.result;
  };
  const outcome = await executeAttempt<FinderResult>(context, task, {
    stage: "find",
    identity: task.assignment,
    prompt: () =>
      assembleFinder(
        input,
        aspect,
        patchFile(context),
        remaining(context, task.result?.examinedPaths ?? []),
      ),
    ingest: (output) => {
      const ingested = ingestFinder(runtime, output, aspect, input);
      rejections = [...rejections, ...ingested.rejections];
      return { value: ingested.result, rejections: ingested.rejections };
    },
    record: (value, complete) => {
      checkpoint(value);
      return finderRecord(value, complete);
    },
    follow: (round, prior) => {
      const value = gather(round, prior);
      const progress =
        value.examinedPaths.length > (prior?.examinedPaths.length ?? 0) ||
        value.findings.length > (prior?.findings.length ?? 0);
      const current = checkpoint(value);
      const left = remaining(context, current.examinedPaths ?? []);
      return {
        value,
        ...(round.status !== "not-applicable" && progress && left.length
          ? { prompt: assembleFollowUp(input, left) }
          : {}),
      };
    },
  });
  if (!outcome.value) return;
  task.rejections = rejections;
  const prior = task.result ?? emptyResult(aspect);
  const merged = mergeFinder(
    {
      ...prior,
      limitations: notesOfOtherStage(prior, "find"),
    },
    {
      ...outcome.value,
      status: outcome.complete ? outcome.value.status : "incomplete",
      limitations: [
        ...outcome.value.limitations,
        ...(rejections.length
          ? [
              `${rejections.length} candidate(s) were rejected by literal source validation.`,
            ]
          : []),
      ],
    },
  );
  const left = remaining(context, merged.examinedPaths ?? []).length;
  task.result =
    outcome.complete && outcome.value.status !== "incomplete" && left
      ? {
          ...merged,
          limitations: [
            ...merged.limitations,
            `${left} of ${input.paths.length} assessed paths were left unexamined.`,
          ],
        }
      : merged;
  update(context, task);
}

const remaining = (context: OwnerContext, examined: readonly string[]) => {
  const done = new Set(examined);
  return context.input.paths.filter((path) => !done.has(path.path));
};

function gather(round: FinderResult, prior?: FinderResult): FinderResult {
  const merged = prior
    ? mergeFinder(
        {
          ...prior,
          findings: prior.findings.map((c) => ({
            ...c,
            verdict: "unverified",
          })),
        },
        round,
      )
    : round;
  return {
    ...merged,
    examinedPaths: merged.examinedPaths ?? [],
    status: merged.findings.length
      ? "findings"
      : round.status === "incomplete"
        ? (prior?.status ??
          (merged.examinedPaths?.length ? "no-findings" : "incomplete"))
        : round.status,
  };
}

function finderRecord(found: FinderResult, complete: boolean): WorkerResult {
  const status = complete ? found.status : "incomplete";
  return {
    aspect: found.aspect,
    status,
    findings: found.findings.map((c) => ({ ...c, verdict: "unverified" })),
    limitations:
      status === "incomplete" && !found.limitations.length
        ? ["Worker lifecycle did not finish successfully."]
        : found.limitations,
    ...(found.reason ? { reason: found.reason } : {}),
    examinedPaths: found.examinedPaths,
  };
}

function update(context: OwnerContext, task: RunTask) {
  if (task.result) task.result = settle(task.result, finderStatus(task));
  context.control.persist();
}

function unresolvedCause(context: OwnerContext, task: RunTask) {
  const { control, execution } = context;
  if (control.stopped()) return control.stopReason;
  return openFailure(task, execution.startedAt)?.failure ?? "incomplete";
}

function finish(context: OwnerContext, task: RunTask) {
  const { control } = context;
  if (task.result) task.result = settle(task.result, finderStatus(task));
  const status = task.result?.status;
  if (status && status !== "incomplete") {
    task.status = status;
    delete task.unresolved;
  } else {
    task.status = task.result
      ? "incomplete"
      : control.stopped()
        ? "cancelled"
        : "failed";
    if (task.status === "cancelled")
      task.limitations.push(`Unexamined aspect: ${control.stopReason}.`);
    task.unresolved = { cause: unresolvedCause(context, task) };
  }
  control.persist();
}
