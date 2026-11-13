import type { RunInput } from "../state/run.ts";
import { type RunTask, resolved } from "../state/run.ts";
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

export function taskReason(task: RunTask, interrupted: boolean) {
  return interrupted && task.status === "running"
    ? "Execution interrupted; last persisted aspect status: running."
    : (task.result?.reason ?? task.attempts.at(-1)?.failure ?? undefined);
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
) {
  const input = context.input;
  const reason = taskReason(task, interrupted);
  const harness = harnessLimitations(task, context);
  const split = portions(task);
  return {
    aspect: task.assignment.aspect,
    status:
      interrupted && task.status === "running" ? "interrupted" : task.status,
    ...(reason ? { reason: preview(reason, full) } : {}),
    ...(task.attempts.at(-1)?.diagnostic && task.status !== "running"
      ? { cause: task.attempts.at(-1)?.diagnostic }
      : {}),
    limitations: taskLimitations(task)
      .filter((l) => l !== reason && !harness.has(l))
      .map((text) => preview(text, full)),
    rejected: task.rejections.length,
    ...(task.unresolved && !resolved(task)
      ? {
          stopCause: task.unresolved.cause,
          pending: task.unresolved.paths.length,
          ...(task.unresolved.stuck?.length
            ? { stuck: task.unresolved.stuck }
            : {}),
          ...(task.result?.unresolved?.length
            ? {
                unresolved: task.result.unresolved.map(
                  (u) => `${u.scope}: ${preview(u.reason, full)}`,
                ),
              }
            : {}),
        }
      : {}),
    ...(task.status === "running" && task.attempts.at(-1)?.lastActivityAt
      ? {
          lastActivity: `${Math.round((context.now - (task.attempts.at(-1)?.lastActivityAt ?? 0)) / 1000)}s ago`,
        }
      : {}),
    ...(split ? { portions: split } : {}),
    examined: task.result?.examinedPaths
      ? `${task.result.examinedPaths.length}/${input.paths.length}`
      : "unknown",
  };
}

export function sumUsage(
  usages: readonly (Record<string, number> | null | undefined)[],
) {
  const known = usages.filter(
    (u): u is Record<string, number> => !!u && Object.keys(u).length > 0,
  );
  if (!usages.length || known.length !== usages.length) return null;
  const keys = Object.keys(known[0] ?? {}).filter((key) =>
    known.every((u) => key in u),
  );
  return keys.length
    ? Object.fromEntries(
        keys.map((key) => [key, known.reduce((n, u) => n + (u[key] ?? 0), 0)]),
      )
    : null;
}

export const taskUsage = (task: RunTask) =>
  sumUsage(task.attempts.map((a) => a.usage));

export function portions(task: RunTask) {
  const sizes = new Map(
    task.attempts.flatMap((a) =>
      a.portion ? [[a.portion.index, a.portion.paths] as const] : [],
    ),
  );
  return sizes.size > 1
    ? `${sizes.size} (${[...sizes.values()].join("/")})`
    : null;
}

const STANDING = new Set(["git-object-writes", "live-context", "coverage"]);
export const shownLimitations = (input: RunInput, full: boolean) =>
  input.limitations
    .filter((l) => full || !STANDING.has(l.code))
    .map((l) => l.message);
