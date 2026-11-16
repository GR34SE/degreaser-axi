import type { Run, RunInput } from "../state/run.ts";
import { openFailure, type RunTask, resolved, sumUsage } from "../state/run.ts";
import type { ReportContext } from "./types.ts";

export function taskLimitations(task: RunTask) {
  return [
    ...new Set([...task.limitations, ...(task.result?.limitations ?? [])]),
  ];
}

export function harnessLimitations(task: RunTask, context: ReportContext) {
  const { agent } = task.assignment;
  return new Set([...(context.harnessLimitations[agent] ?? [])]);
}

export const executionStart = (run: Run) =>
  run.executions?.at(-1)?.startedAt ?? 0;

export const failedAttempt = (task: RunTask, since: number) =>
  resolved(task) ? undefined : openFailure(task, since);

export function taskReason(task: RunTask, interrupted: boolean, since: number) {
  return interrupted && task.status === "running"
    ? "Execution interrupted; last persisted aspect status: running."
    : (task.result?.reason ??
        (resolved(task)
          ? undefined
          : (task.unresolved?.cause ?? failedAttempt(task, since)?.failure)) ??
        undefined);
}

const preview = (text: string, full: boolean) =>
  full || text.length <= 240
    ? text
    : `${text.slice(0, 240)}… (${text.length} chars; report --full)`;

export function coverage(
  task: RunTask,
  context: ReportContext,
  interrupted: boolean,
  full: boolean,
  since: number,
) {
  const reason = taskReason(task, interrupted, since);
  const failed = failedAttempt(task, since);
  const harness = harnessLimitations(task, context);
  const stages = stageSummary(task);
  return {
    aspect: task.assignment.aspect,
    status:
      interrupted && task.status === "running" ? "interrupted" : task.status,
    ...(reason ? { reason: preview(reason, full) } : {}),
    ...(failed?.diagnostic && task.status !== "running"
      ? { cause: failed.diagnostic }
      : {}),
    limitations: taskLimitations(task)
      .filter((l) => l !== reason && !harness.has(l))
      .map((text) => preview(text, full)),
    rejected: task.rejections.length,
    ...counts(task),
    ...(stages ? { stages } : {}),
    ...(task.unresolved && !resolved(task)
      ? {
          stopCause: task.unresolved.cause,
          pending: task.unresolved.paths.length,
        }
      : {}),
    ...(task.status === "running" && task.attempts.at(-1)?.lastActivityAt
      ? {
          lastActivity: `${Math.round((context.now - (task.attempts.at(-1)?.lastActivityAt ?? 0)) / 1000)}s ago`,
        }
      : {}),
  };
}

export const taskUsage = (task: RunTask) =>
  sumUsage(task.attempts.map((a) => a.usage));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function stageSummary(task: RunTask) {
  const parts = (["find", "verify"] as const).flatMap((stage) => {
    const shards = new Set(
      task.attempts.flatMap((a) =>
        a.stage === stage ? [a.portion?.index ?? 0] : [],
      ),
    );
    return shards.size
      ? [plural(shards.size, stage === "find" ? "finder" : "verifier")]
      : [];
  });
  return parts.length ? parts.join(", ") : null;
}

export function verdictCounts(tasks: readonly RunTask[]) {
  const all = tasks.flatMap((t) => t.result?.findings ?? []);
  const count = (verdict: string) =>
    all.filter((f) => f.verdict === verdict).length;
  return {
    upheld: count("upheld"),
    refuted: count("refuted"),
    unverified: count("unverified"),
  };
}

const counts = (task: RunTask) => verdictCounts([task]);

const STANDING = new Set(["git-object-writes", "live-context", "coverage"]);
export const shownLimitations = (input: RunInput, full: boolean) =>
  input.limitations
    .filter((l) => full || !STANDING.has(l.code))
    .map((l) => l.message);
