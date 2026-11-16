import { join } from "node:path";
import type { Assignment } from "../../config/types.ts";
import type { RunTask } from "../../state/run.ts";
import { executeAttempt } from "../attempt/index.ts";
import { assembleVerifier } from "../attempt/prompt/assemble.ts";
import { applyVerdicts, verdictStatus } from "../ingest/merge.ts";
import type { Finding, VerifierResult, WorkerResult } from "../ingest/types.ts";
import { ingestVerifier } from "../ingest/verify-quotes.ts";
import type { OwnerContext } from "./context.ts";

export const VERIFIER = "Verifier: ";
const MIN_BATCH = 5;
const MAX_BATCH = 10;
const PERMANENT_FAILURES = new Set([
  "authentication",
  "model-unavailable",
  "rate-limited",
  "account-disabled",
  "environment-blocked",
]);
const unverified = (findings: readonly Finding[]) =>
  findings.filter((finding) => finding.verdict === "unverified");

export function verification(
  context: OwnerContext,
  task: RunTask,
  changed: () => void,
) {
  const waiting: Finding[] = [];
  const seen = new Set<Finding>();
  const active = new Set<Promise<void>>();
  const errors: unknown[] = [];
  let closed = false;
  if (task.result)
    task.result.limitations = task.result.limitations.filter(
      (limitation) => !limitation.startsWith(VERIFIER),
    );
  const runBatch = async (batch: Finding[]) => {
    const outcome = await verifyBatch(context, task, batch, changed);
    if (
      !outcome.pending.length ||
      outcome.cleanupFailed ||
      context.control.stopped() ||
      PERMANENT_FAILURES.has(outcome.failure ?? "")
    )
      return;
    const size = Math.max(1, Math.floor(batch.length / 2));
    task.limitations.push(
      `${VERIFIER}Retrying ${outcome.pending.length} candidate(s) without a verdict once, in batches of at most ${size}.`,
    );
    context.control.persist();
    const retries: Promise<unknown>[] = [];
    for (let i = 0; i < outcome.pending.length; i += size)
      retries.push(
        verifyBatch(context, task, outcome.pending.slice(i, i + size), changed),
      );
    await Promise.all(retries);
  };
  const enqueue = () => {
    for (const finding of unverified(task.result?.findings ?? []))
      if (!seen.has(finding)) {
        seen.add(finding);
        waiting.push(finding);
      }
    while (waiting.length >= MIN_BATCH || (closed && waiting.length)) {
      const batch = waiting.splice(0, MAX_BATCH);
      const work = runBatch(batch)
        .catch((error: unknown) => {
          errors.push(error);
          if (context.control.persistenceError)
            context.control.fail(
              error,
              "Verifier progress could not be persisted.",
            );
        })
        .finally(() => active.delete(work));
      active.add(work);
    }
  };
  return {
    enqueue,
    async finish() {
      closed = true;
      enqueue();
      while (active.size) await Promise.all([...active]);
      if (errors.length) throw errors[0];
    },
  };
}

async function verifyBatch(
  context: OwnerContext,
  task: RunTask,
  pending: readonly Finding[],
  changed: () => void,
) {
  const { runtime, input } = context;
  const aspect = task.assignment.aspect;
  const verifier: Assignment = { ...input.config.verifier, aspect };
  const outcome = await executeAttempt<VerifierResult>(context, task, {
    stage: "verify",
    retries: 0,
    identity: verifier,
    prompt: assembleVerifier(
      input,
      aspect,
      join(context.dir, "input", "patch.diff"),
      pending,
    ),
    ingest: (output) => ({
      value: ingestVerifier(runtime, output, aspect, input, pending.length),
    }),
    record: (verified) => verifierRecord(pending, verified),
  });
  const judged = outcome.value
    ? applyVerdicts(pending, outcome.value.verdicts)
    : [...pending];
  if (task.result) {
    const replaced = new Map(
      pending.map((finding, i) => [finding, judged[i] ?? finding]),
    );
    task.result = {
      ...task.result,
      findings: task.result.findings.map(
        (finding) => replaced.get(finding) ?? finding,
      ),
      limitations: [
        ...task.result.limitations,
        ...(outcome.value?.limitations ?? []).map(
          (limitation) => `${VERIFIER}${limitation}`,
        ),
        ...(outcome.value && !outcome.complete
          ? [
              `${VERIFIER}worker lifecycle did not finish successfully; valid verdicts were retained.`,
            ]
          : []),
      ],
    };
    changed();
  }
  return {
    pending: unverified(judged),
    failure: outcome.failure,
    cleanupFailed: outcome.cleanupFailed,
  };
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
