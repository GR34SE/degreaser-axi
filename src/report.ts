import { ownerAlive } from "./ownership.ts";
import { loadInput, type Run, resolved } from "./storage.ts";

export function observedStatus(run: Run) {
  if (run.status !== "running") return run.status;
  if (!run.owner)
    return Date.now() - run.createdAt < 10_000 ? "running" : "interrupted";
  return ownerAlive(run.owner) ? "running" : "interrupted";
}
export function findings(run: Run) {
  return run.tasks
    .flatMap((t) =>
      (t.result?.findings ?? []).map((f) => ({
        aspect: t.assignment.aspect,
        ...f,
      })),
    )
    .sort(
      (a, b) =>
        a.location.path.localeCompare(b.location.path, "en") ||
        a.location.startLine - b.location.startLine ||
        a.location.side.localeCompare(b.location.side) ||
        a.aspect.localeCompare(b.aspect) ||
        a.title.localeCompare(b.title),
    )
    .map((f, index) => ({ id: `F${index + 1}`, ...f }));
}
export function renderReport(run: Run, full = false) {
  const input = loadInput(run);
  const status = observedStatus(run);
  const all = findings(run),
    shown = full ? all : all.slice(0, 30);
  process.exitCode = status === "running" ? 3 : status === "completed" ? 0 : 1;
  return {
    run: run.id,
    status,
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
          aspect: f.aspect,
          location: `${f.location.path}:${f.location.side}:${f.location.startLine}-${f.location.endLine}`,
          title: f.title,
        })),
    coverage: run.tasks.map((t) => ({
      aspect: t.assignment.aspect,
      status: t.status,
      reason: t.result?.reason ?? t.attempts.at(-1)?.failure ?? "",
    })),
    limitations: [
      ...input.limitations.map((l) => l.message),
      ...new Set(
        run.tasks.flatMap((t) => [
          ...t.limitations,
          ...(t.result?.limitations ?? []),
        ]),
      ),
    ],
    ...(full
      ? {
          task: input.task,
          base: input.base,
          tree: input.tree,
          paths: input.paths.map((p) => p.path),
          execution: run.tasks.map((t) => ({
            ...t.assignment,
            attempts: t.attempts,
            rejections: t.rejections,
            usage: t.usage ?? "unknown",
          })),
          controls: run.executions ?? [],
        }
      : {}),
    usage: run.tasks.every((t) => t.usage !== null)
      ? run.tasks.map((t) => ({ aspect: t.assignment.aspect, ...t.usage }))
      : "unknown",
    help:
      status === "running"
        ? [`degreaser-axi wait ${run.id}`]
        : [
            `degreaser-axi report ${run.id} --full`,
            ...(status !== "completed"
              ? [
                  `degreaser-axi resume ${run.id}${Date.now() >= run.deadline ? " --deadline 900" : ""}`,
                ]
              : []),
            ...(all.length ? [`degreaser-axi finding F1 --run ${run.id}`] : []),
            ...(run.tasks.some(
              (task) => task.attempts.at(-1)?.failure === "rate-limited",
            )
              ? [
                  `After the selected account limit clears, keep the same model and run: degreaser-axi resume ${run.id} --concurrency 1`,
                ]
              : []),
          ],
  };
}
