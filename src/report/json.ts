import type { Run } from "../state/run.ts";
import { coverage, taskLimitations } from "./details.ts";
import { findings } from "./group.ts";
import type { ReportContext } from "./types.ts";

export function exportRun(run: Run, context: ReportContext) {
  const input = context.input;
  const status = context.status;
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
      coverageBasis: "worker-declared",
      coverage: run.tasks.map((t) =>
        coverage(t, context, status === "interrupted", true),
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
