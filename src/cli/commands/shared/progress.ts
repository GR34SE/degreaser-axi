import { type Run, resumable } from "../../../state/run.ts";
import type { Factory } from "../../factory.ts";

const began = (run: Run) => run.executions?.at(-1)?.startedAt ?? run.createdAt;

const finished = (run: Run) =>
  run.tasks.filter(
    (task) =>
      task.status !== "pending" &&
      task.status !== "running" &&
      (run.status !== "running" ||
        !resumable(task) ||
        task.attempts.some((attempt) => attempt.startedAt >= began(run))),
  );

export function progressFor(f: Factory, initial: Run) {
  const seen = new Set(finished(initial).map((task) => task.assignment.aspect));
  let last = f.now();
  return (run: Run) => {
    const completed = finished(run);
    const newly = completed.filter((task) => !seen.has(task.assignment.aspect));
    const now = f.now();
    if (!newly.length && now - last < 30_000) return;
    const candidates = run.tasks.flatMap((task) => task.result?.findings ?? []);
    const verdicts = candidates.filter(
      (finding) => finding.verdict !== "unverified",
    ).length;
    const summary = `run: ${run.id}; aspects: ${completed.length}/${run.tasks.length}; candidates: ${candidates.length}; verdicts: ${verdicts}; elapsed: ${Math.max(0, Math.floor((now - began(run)) / 1000))}s`;
    if (newly.length)
      for (const task of newly) {
        seen.add(task.assignment.aspect);
        f.io.error.write(
          `${summary}; aspect: ${task.assignment.aspect} (${task.status})\n`,
        );
      }
    else f.io.error.write(`${summary}\n`);
    last = now;
  };
}
