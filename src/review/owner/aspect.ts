import { join } from "node:path";
import type { Assignment } from "../../config/types.ts";
import { openFailure, type RunTask } from "../../state/run.ts";
import { StateError } from "../../util/errors.ts";
import { executeAttempt } from "../attempt/index.ts";
import {
  assembleFinder,
  assembleFollowUp,
  assembleVerifier,
  promptIdentity,
} from "../attempt/prompt/assemble.ts";
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

function finderStatus(task: RunTask): FinderResult["status"] {
  const last = task.attempts.findLast((a) => a.stage === "find" && a.result);
  return last?.result && !last.failure ? last.result.status : "incomplete";
}

const unverified = (findings: readonly Finding[]) =>
  findings.filter((f) => f.verdict === "unverified");

const patchFile = (context: OwnerContext) =>
  join(context.dir, "input", "patch.diff");

export async function reviewAspect(context: OwnerContext, task: RunTask) {
  const aspect = task.assignment.aspect;
  if (promptIdentity(aspect) !== task.promptHash)
    throw new StateError(
      "input-changed",
      `Prompt identity for ${aspect} differs from ${join(context.dir, "run.json")}. Start a new review with the current package.`,
    );
  try {
    if (finderStatus(task) === "incomplete") await find(context, task);
    const pending = unverified(task.result?.findings ?? []);
    if (pending.length) await verify(context, task, pending);
  } catch (error) {
    context.control.fail(
      error,
      `Aspect ${aspect} could not complete because of an unexpected owner task error.`,
    );
    if (!context.control.persistenceError) finish(context, task);
    throw error;
  }
  finish(context, task);
}

async function find(context: OwnerContext, task: RunTask) {
  const { runtime, input } = context;
  const aspect = task.assignment.aspect;
  let rejections: Rejection[] = [];
  const outcome = await executeAttempt<FinderResult>(context, task, {
    stage: "find",
    identity: task.assignment,
    prompt: assembleFinder(input, aspect, patchFile(context)),
    ingest: (output) => {
      const ingested = ingestFinder(runtime, output, aspect, input);
      rejections = [...rejections, ...ingested.rejections];
      return { value: ingested.result, rejections: ingested.rejections };
    },
    record: finderRecord,
    follow: (round, prior) => {
      const value = gather(round, prior);
      const progress =
        value.examinedPaths.length > (prior?.examinedPaths.length ?? 0) ||
        value.findings.length > (prior?.findings.length ?? 0);
      const left = remaining(context, value.examinedPaths);
      return {
        value,
        ...(progress && left.length
          ? { prompt: assembleFollowUp(input, left) }
          : {}),
      };
    },
  });
  if (!outcome) return;
  task.rejections = rejections;
  const merged = mergeFinder(task.result ?? emptyResult(aspect), {
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
  });
  const left = remaining(context, merged.examinedPaths ?? []).length;
  task.result =
    outcome.complete && left
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

const remaining = (context: OwnerContext, examined: readonly string[]) =>
  context.input.paths.filter((p) => !examined.includes(p.path));

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

async function verify(
  context: OwnerContext,
  task: RunTask,
  pending: readonly Finding[],
) {
  const { runtime, input } = context;
  const aspect = task.assignment.aspect;
  const verifier: Assignment = { ...input.config.verifier, aspect };
  const outcome = await executeAttempt<VerifierResult>(context, task, {
    stage: "verify",
    identity: verifier,
    prompt: assembleVerifier(input, aspect, patchFile(context), pending),
    ingest: (output) => ({
      value: ingestVerifier(runtime, output, aspect, input, pending.length),
    }),
    record: (verified, complete) =>
      verifierRecord(
        pending,
        complete ? verified : { ...verified, verdicts: [] },
      ),
  });
  if (!outcome || !task.result) return;
  const judged = outcome.complete
    ? applyVerdicts(pending, outcome.value.verdicts)
    : pending;
  const replaced = new Map(pending.map((f, i) => [f, judged[i] ?? f]));
  task.result = {
    ...task.result,
    findings: task.result.findings.map((f) => replaced.get(f) ?? f),
    limitations: [
      ...task.result.limitations,
      ...outcome.value.limitations.map((l) => `Verifier: ${l}`),
      ...(outcome.complete
        ? []
        : [
            "Verifier: worker lifecycle did not finish successfully; its verdicts were not applied.",
          ]),
    ],
  };
  update(context, task);
}

function verifierRecord(
  pending: readonly Finding[],
  verified: VerifierResult,
): WorkerResult {
  const findings = applyVerdicts(pending, verified.verdicts);
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
  if (task.result) task.result = settle(task.result, finderStatus(task));
  context.control.persist();
}

function unresolvedCause(context: OwnerContext, task: RunTask) {
  const { control, startedAt } = context;
  if (control.stopped()) return control.stopReason;
  return openFailure(task, startedAt)?.failure ?? "incomplete";
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
