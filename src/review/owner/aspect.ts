import { join } from "node:path";
import type { Assignment } from "../../config/types.ts";
import { openFailure, type RunTask } from "../../state/run.ts";
import { StateError } from "../../util/errors.ts";
import { executeAttempt } from "../attempt/index.ts";
import {
  assembleFinder,
  assembleVerifier,
  promptIdentity,
} from "../attempt/prompt/assemble.ts";
import {
  packShards,
  SHARD_BYTES,
  uncovered,
  VERIFY_BATCH,
  verifyBatches,
} from "../ingest/coverage.ts";
import {
  applyVerdicts,
  emptyResult,
  mergeFinder,
  settle,
  verdictStatus,
} from "../ingest/merge.ts";
import type {
  FinderResult,
  Finding,
  Rejection,
  VerifierResult,
  WorkerResult,
} from "../ingest/types.ts";
import { ingestFinder, ingestVerifier } from "../ingest/verify-quotes.ts";
import type { OwnerContext } from "./context.ts";

const nextIndex = (task: RunTask, stage: "find" | "verify") =>
  Math.max(
    0,
    ...task.attempts
      .filter((a) => a.stage === stage)
      .map((a) => a.portion?.index ?? 0),
  );

const finderStatuses = (task: RunTask) =>
  task.attempts.flatMap((a) =>
    a.stage === "find" && !a.failure && a.result ? [a.result.status] : [],
  );

const unverified = (findings: readonly Finding[]) =>
  findings.filter((f) => f.verdict === "unverified");

export async function reviewAspect(context: OwnerContext, task: RunTask) {
  const { input, sizesOf } = context;
  const aspect = task.assignment.aspect;
  if (promptIdentity(aspect) !== task.promptHash)
    throw new StateError(
      "input-changed",
      `Prompt identity for ${aspect} differs from ${join(context.dir, "run.json")}. Start a new review with the current package.`,
    );
  const pending = unverified(task.result?.findings ?? []);
  const shards = packShards(
    uncovered(input, task.result?.examinedPaths ?? []),
    sizesOf(),
    SHARD_BYTES,
  );
  if (!shards.length) task.result ??= emptyResult(aspect);
  const findBase = nextIndex(task, "find");
  let batchIndex = nextIndex(task, "verify");
  const guard = <T>(work: Promise<T>) =>
    work.catch((error: unknown) => {
      context.control.fail(
        error,
        `Aspect ${aspect} could not complete because of an unexpected owner task error.`,
      );
      throw error;
    });
  const verify = (findings: Finding[]) =>
    settleAll(
      verifyBatches(findings, VERIFY_BATCH).map((batch) =>
        guard(verifyBatch(context, task, batch, ++batchIndex)),
      ),
    );
  const chains = [
    ...shards.map((shard, i) =>
      guard(findShard(context, task, shard, findBase + i + 1)).then(verify),
    ),
    verify(pending),
  ];
  try {
    await settleAll(chains);
  } catch (error) {
    if (!context.control.persistenceError) finish(context, task);
    throw error;
  }
  finish(context, task);
}

async function settleAll(work: readonly Promise<unknown>[]) {
  const failed = (await Promise.allSettled(work)).find(
    (outcome) => outcome.status === "rejected",
  );
  if (failed) throw failed.reason;
}

async function findShard(
  context: OwnerContext,
  task: RunTask,
  shard: string[],
  index: number,
) {
  const { runtime, input, dir } = context;
  const aspect = task.assignment.aspect;
  const members = new Set(shard);
  const shardInput = {
    ...input,
    paths: input.paths.filter((p) => members.has(p.path)),
  };
  let rejections: Rejection[] = [];
  let covered: string[] = shard;
  const outcome = await executeAttempt<FinderResult>(context, task, {
    stage: "find",
    portion: { index },
    identity: task.assignment,
    prompt: assembleFinder(
      runtime,
      input,
      aspect,
      join(dir, "input", "patch.diff"),
      shard,
    ),
    ingest: (output) => {
      const ingested = ingestFinder(runtime, output, aspect, shardInput);
      rejections = ingested.rejections;
      covered = shard.filter((p) => !ingested.unexamined.has(p));
      return { value: ingested.result, rejections };
    },
    record: (found, complete) => finderRecord(found, complete, covered),
  });
  if (!outcome) return [];
  const found: FinderResult = outcome.complete
    ? outcome.value
    : { ...outcome.value, status: "incomplete" };
  task.result ??= emptyResult(aspect);
  task.rejections.push(...rejections);
  const added = mergeFinder(task.result, found, shard, covered, index);
  update(context, task);
  return added;
}

function finderRecord(
  found: FinderResult,
  complete: boolean,
  covered: readonly string[],
): WorkerResult {
  const status = complete ? found.status : "incomplete";
  return {
    aspect: found.aspect,
    status,
    findings: found.findings.map((c) => ({ ...c, verdict: "unverified" })),
    ...(found.kept ? { kept: found.kept } : {}),
    limitations:
      status === "incomplete" && !found.limitations.length
        ? ["Worker lifecycle did not finish successfully."]
        : found.limitations,
    ...(found.reason ? { reason: found.reason } : {}),
    examinedPaths: status === "incomplete" ? [] : [...covered],
  };
}

async function verifyBatch(
  context: OwnerContext,
  task: RunTask,
  batch: Finding[],
  index: number,
) {
  const { runtime, input, dir } = context;
  const aspect = task.assignment.aspect;
  const verifier: Assignment = { ...input.config.verifier, aspect };
  const outcome = await executeAttempt<VerifierResult>(context, task, {
    stage: "verify",
    portion: { index },
    identity: verifier,
    prompt: assembleVerifier(
      input,
      aspect,
      join(dir, "input", "patch.diff"),
      batch,
    ),
    ingest: (output) => ({
      value: ingestVerifier(runtime, output, aspect, input, batch.length),
    }),
    record: (verified, complete) =>
      verifierRecord(
        batch,
        complete ? verified : { ...verified, verdicts: [] },
      ),
  });
  if (!outcome || !task.result) return;
  if (outcome.complete) applyVerdicts(batch, outcome.value.verdicts);
  task.result.limitations.push(
    ...outcome.value.limitations.map((l) => `Verifier batch ${index}: ${l}`),
    ...(outcome.complete
      ? []
      : [
          `Verifier batch ${index}: worker lifecycle did not finish successfully; its verdicts were not applied.`,
        ]),
  );
  update(context, task);
}

function verifierRecord(
  batch: readonly Finding[],
  verified: VerifierResult,
): WorkerResult {
  const findings = structuredClone([...batch]);
  applyVerdicts(findings, verified.verdicts);
  const open = unverified(findings).length;
  return {
    aspect: verified.aspect,
    status: verdictStatus(findings),
    findings,
    limitations: [
      ...verified.limitations,
      ...(open ? [`${open} candidate(s) without a valid verdict.`] : []),
    ],
  };
}

function update(context: OwnerContext, task: RunTask) {
  if (task.result) settle(context.input, task.result, finderStatuses(task));
  context.control.persist();
}

function finish(context: OwnerContext, task: RunTask) {
  const { control, input } = context;
  const status = task.result
    ? settle(input, task.result, finderStatuses(task))
    : null;
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
    task.unresolved = {
      cause: control.stopped()
        ? control.stopReason
        : (openFailure(task, context.startedAt)?.failure ??
          (task.result?.findings.some((f) => f.verdict === "unverified")
            ? "unverified"
            : "incomplete")),
      paths: uncovered(input, task.result?.examinedPaths ?? []),
    };
  }
  control.persist();
}
