import { ASPECT_IDS, type AspectId } from "./config.ts";
import { type ReviewInput, reviewCommand } from "./input.ts";
import { PROFILE_LIMITATIONS } from "./native-profile.ts";
import {
  ownerAlive,
  ownerRecoveryGuidance,
  processAlive,
} from "./ownership.ts";
import type { Finding } from "./results.ts";
import {
  loadInput,
  type Run,
  type RunTask,
  resolved,
  StateError,
} from "./storage.ts";
import { turnBudgetLimitations } from "./worker-runtime.ts";

export function observedStatus(run: Run) {
  if (run.status !== "running") return run.status;
  if (!run.owner)
    return Date.now() - run.createdAt < 10_000 ? "running" : "interrupted";
  return ownerAlive(run.owner) ? "running" : "interrupted";
}
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
type AspectFinding = Finding & { aspect: AspectId };
function compareFindings(a: AspectFinding, b: AspectFinding): number {
  return (
    compareText(a.location.path, b.location.path) ||
    a.location.startLine - b.location.startLine ||
    compareText(a.location.side, b.location.side) ||
    a.location.endLine - b.location.endLine ||
    ASPECT_IDS.indexOf(a.aspect) - ASPECT_IDS.indexOf(b.aspect) ||
    compareText(a.title, b.title) ||
    compareText(a.quote, b.quote) ||
    compareText(a.evidence, b.evidence) ||
    compareText(a.consequence, b.consequence) ||
    compareText(a.countercheck, b.countercheck) ||
    compareText(a.recommendation, b.recommendation) ||
    compareText(a.uncertainty ?? "", b.uncertainty ?? "") ||
    Number(a.uncertainty !== undefined) - Number(b.uncertainty !== undefined)
  );
}
export function findings(run: Run) {
  const ordered = run.tasks
    .flatMap((t) =>
      (t.result?.findings ?? []).map((f) => ({
        aspect: t.assignment.aspect,
        ...f,
      })),
    )
    .sort(
      (a, b) =>
        compareText(a.location.path, b.location.path) ||
        compareText(a.location.side, b.location.side) ||
        compareFindings(a, b),
    );
  const groups: {
    first: AspectFinding;
    end: number;
    members: AspectFinding[];
  }[] = [];
  for (const finding of ordered) {
    const group = groups.at(-1);
    if (
      group &&
      group.first.location.path === finding.location.path &&
      group.first.location.side === finding.location.side &&
      finding.location.startLine <= group.end
    ) {
      group.members.push(finding);
      group.end = Math.max(group.end, finding.location.endLine);
    } else {
      groups.push({
        first: finding,
        end: finding.location.endLine,
        members: [finding],
      });
    }
  }
  return groups
    .sort((a, b) => compareFindings(a.first, b.first))
    .flatMap((group, index) =>
      group.members.map((finding) => ({ group: `G${index + 1}`, ...finding })),
    )
    .map((finding, index) => ({ id: `F${index + 1}`, ...finding }));
}

function taskLimitations(task: RunTask) {
  return [
    ...new Set([...task.limitations, ...(task.result?.limitations ?? [])]),
  ];
}

function harnessLimitations(task: RunTask, input: ReviewInput) {
  const { agent } = task.assignment;
  return new Set([
    ...PROFILE_LIMITATIONS[agent],
    ...turnBudgetLimitations(agent, input.config.limits.maxTurns),
  ]);
}

function taskReason(task: RunTask, interrupted: boolean) {
  return interrupted && task.status === "running"
    ? "Execution interrupted; last persisted aspect status: running."
    : (task.result?.reason ?? task.attempts.at(-1)?.failure ?? undefined);
}

function coverage(task: RunTask, input: ReviewInput, interrupted: boolean) {
  const reason = taskReason(task, interrupted);
  const harness = harnessLimitations(task, input);
  return {
    aspect: task.assignment.aspect,
    status:
      interrupted && task.status === "running" ? "interrupted" : task.status,
    ...(reason ? { reason } : {}),
    limitations: taskLimitations(task).filter(
      (l) => l !== reason && !harness.has(l),
    ),
    rejected: task.rejections.length,
    ...(task.status === "running" && task.attempts.at(-1)?.lastActivityAt
      ? {
          lastActivity: `${Math.round((Date.now() - (task.attempts.at(-1)?.lastActivityAt ?? 0)) / 1000)}s ago`,
        }
      : {}),
    examined: task.result?.examinedPaths
      ? `${task.result.examinedPaths.length}/${input.paths.length}`
      : "unknown",
  };
}

function latestUsage(task: RunTask) {
  const usage = task.attempts.at(-1)?.usage;
  return usage && Object.keys(usage).length > 0 ? usage : null;
}

/** Input limitations that are the same for every review; shown only in full detail. */
const STANDING = new Set(["git-object-writes", "live-context", "coverage"]);
const shownLimitations = (input: ReviewInput, full: boolean) =>
  input.limitations
    .filter((l) => full || !STANDING.has(l.code))
    .map((l) => l.message);

export function renderFinding(run: Run, id: string | undefined) {
  const input = loadInput(run);
  const finding = findings(run).find((f) => f.id === id);
  if (!finding)
    throw new StateError(
      "finding-not-found",
      `Finding not found in ${run.id}: ${id}. Use degreaser-axi report ${run.id} --full.`,
    );
  const task = run.tasks.find((t) => t.assignment.aspect === finding.aspect);
  if (!task) throw new Error("Finding has no assigned aspect.");
  return {
    run: run.id,
    evidenceLevel: "source-only",
    ...finding,
    aspectStatus: task.status,
    limitations: [...shownLimitations(input, false), ...taskLimitations(task)],
    rejections: task.rejections,
  };
}
export function renderReport(run: Run, full = false) {
  const input = loadInput(run);
  const status = observedStatus(run);
  const failure = run.executions?.at(-1)?.failure;
  const stopReason = run.executions?.at(-1)?.stopReason;
  const unverifiedOwner =
    status === "interrupted" && run.owner && processAlive(run.owner.pid);
  const canResume =
    status !== "completed" &&
    !unverifiedOwner &&
    failure?.code !== "input-changed";
  const all = findings(run),
    shown = full ? all : all.slice(0, 30);
  const workers = run.tasks.filter((task) => task.promptHash !== null);
  process.exitCode = status === "running" ? 3 : status === "completed" ? 0 : 1;
  return {
    run: run.id,
    status,
    ...(failure ? { failure } : {}),
    ...(stopReason ? { stopReason } : {}),
    evidence: "source-only",
    scope: input.scope,
    aspects: `${run.tasks.filter(resolved).length}/${run.tasks.length}`,
    count: all.length,
    shown: shown.length,
    rejected: run.tasks.reduce((n, t) => n + t.rejections.length, 0),
    findings: full
      ? shown
      : shown.map((f) => ({
          id: f.id,
          group: f.group,
          aspect: f.aspect,
          location: `${f.location.path}:${f.location.side}:${f.location.startLine}-${f.location.endLine}`,
          title: f.title,
        })),
    coverage: run.tasks.map((t) =>
      coverage(t, input, status === "interrupted"),
    ),
    limitations: [
      ...shownLimitations(input, full),
      ...new Set(run.tasks.flatMap(taskLimitations)),
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
              usage: latestUsage(t) ?? "unknown",
            })),
          controls: run.executions ?? [],
        }
      : {}),
    usageScope: "latest-attempt-per-aspect",
    usage:
      workers.length > 0 && workers.every((t) => latestUsage(t) !== null)
        ? workers.map((t) => ({
            aspect: t.assignment.aspect,
            ...latestUsage(t),
          }))
        : "unknown",
    help:
      status === "running"
        ? [
            `degreaser-axi wait ${run.id}`,
            ...(all.length > shown.length
              ? [`degreaser-axi report ${run.id} --full`]
              : []),
            ...(all.length ? [`degreaser-axi finding F1 --run ${run.id}`] : []),
          ]
        : [
            ...(!full && all.length
              ? [`degreaser-axi report ${run.id} --full`]
              : []),
            ...(unverifiedOwner ? [ownerRecoveryGuidance(run)] : []),
            ...(canResume
              ? [
                  `degreaser-axi resume ${run.id}${Date.now() >= run.deadline ? " --deadline 900" : ""}`,
                ]
              : []),
            ...(all.length ? [`degreaser-axi finding F1 --run ${run.id}`] : []),
            reviewCommand(input),
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
                  `After the selected account limit clears, keep the same model and run: degreaser-axi resume ${run.id} --concurrency 1${Date.now() >= run.deadline ? " --deadline 900" : ""}`,
                ]
              : []),
          ],
  };
}

/** Stable JSON for other tools; findings are flattened and never clipped. */
export function exportRun(run: Run) {
  const input = loadInput(run);
  const status = observedStatus(run);
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      run: run.id,
      status,
      scope: input.scope,
      task: input.task,
      base: input.base,
      tree: input.tree,
      findings: findings(run).map(({ location, ...finding }) => ({
        ...finding,
        ...location,
      })),
      coverage: run.tasks.map((t) =>
        coverage(t, input, status === "interrupted"),
      ),
      limitations: [
        ...input.limitations.map((l) => l.message),
        ...new Set(run.tasks.flatMap(taskLimitations)),
      ],
    },
    null,
    2,
  )}\n`;
}
