import { type Run, resolved } from "../state/run.ts";
import {
  coverage,
  harnessLimitations,
  shownLimitations,
  sumUsage,
  taskLimitations,
  taskReason,
  taskUsage,
  verdictCounts,
} from "./details.ts";
import { findings } from "./findings.ts";
import { present } from "./present.ts";
import { upheldRows } from "./rows.ts";
import type { ReportContext } from "./types.ts";

export function renderReport(run: Run, context: ReportContext, full = false) {
  const input = context.input;
  const status = context.status;
  const failure = run.executions?.at(-1)?.failure;
  const stopReason = run.executions?.at(-1)?.stopReason;
  const unverifiedOwner = context.unverifiedOwner;
  const canResume =
    status !== "completed" &&
    !unverifiedOwner &&
    failure?.code !== "input-changed";
  const all = findings(run);
  const counts = verdictCounts(run.tasks);
  const hidden = counts.refuted + counts.unverified;
  const workers = run.tasks.filter((task) => task.promptHash !== null);
  const usage = sumUsage(workers.map(taskUsage));
  const clipped =
    !full &&
    run.tasks.some((task) =>
      [
        taskReason(task, status === "interrupted") ?? "",
        ...taskLimitations(task),
      ].some((text) => text.length > 240),
    );
  return {
    run: run.id,
    status,
    ...(failure ? { failure } : {}),
    ...(stopReason ? { stopReason } : {}),
    evidence: "source-only",
    scope: input.scope,
    aspects: `${run.tasks.filter(resolved).length}/${run.tasks.length}`,
    ...counts,
    rejected: run.tasks.reduce((n, t) => n + t.rejections.length, 0),
    findings: full ? all.map(present) : upheldRows(all),
    coverageBasis: "coordinator-assigned",
    coverage: run.tasks.map((t) =>
      coverage(t, context, status === "interrupted", full),
    ),
    limitations: [
      ...shownLimitations(input, full),
      ...new Set(
        run.tasks.flatMap((task) =>
          taskLimitations(task).filter((text) =>
            harnessLimitations(task, context).has(text),
          ),
        ),
      ),
    ],
    ...(full
      ? {
          task: input.task,
          base: input.base,
          tree: input.tree,
          paths: input.paths.length,
          pathList: `.degreaser/runs/${run.id}/input/review.json`,
          configuration: input.config.assignments,
          coordinator: input.coordinatorResults,
          execution: workers
            .filter((t) => t.attempts.length > 0)
            .map((t) => ({
              ...t.assignment,
              attemptStatusBasis: "last-persisted",
              attempts: t.attempts,
              rejections: t.rejections,
              usage: taskUsage(t) ?? "unknown",
            })),
          controls: run.executions ?? [],
          aspectUsage: usage
            ? workers.map((t) => ({
                aspect: t.assignment.aspect,
                ...taskUsage(t),
              }))
            : "unknown",
        }
      : {}),
    usageScope: "all-attempts-per-aspect",
    usage: usage ?? "unknown",
    help:
      status === "running"
        ? [
            `degreaser-axi wait ${run.id}`,
            ...(hidden || clipped
              ? [`degreaser-axi report ${run.id} --full`]
              : []),
            ...(all.length ? [`degreaser-axi finding F1 --run ${run.id}`] : []),
          ]
        : [
            ...(!full && (hidden || clipped)
              ? [`degreaser-axi report ${run.id} --full`]
              : []),
            ...(unverifiedOwner ? [context.ownerRecovery] : []),
            ...(canResume
              ? [
                  `degreaser-axi resume ${run.id}${context.now >= run.deadline ? " --deadline 900" : ""}`,
                ]
              : []),
            ...(all.length ? [`degreaser-axi finding F1 --run ${run.id}`] : []),
            context.reviewCommand,
            ...(canResume &&
            run.tasks.some(
              (task) => task.attempts.at(-1)?.failure === "account-disabled",
            )
              ? [
                  "Restore access to the selected account with its provider before resuming. A disabled or suspended account is not a transient rate limit; waiting or lowering concurrency does not restore access.",
                ]
              : []),
            ...(canResume &&
            run.tasks.some(
              (task) => task.attempts.at(-1)?.failure === "rate-limited",
            )
              ? [
                  `After the selected account limit clears, keep the same model and run: degreaser-axi resume ${run.id} --concurrency 1${context.now >= run.deadline ? " --deadline 900" : ""}`,
                ]
              : []),
          ],
  };
}
