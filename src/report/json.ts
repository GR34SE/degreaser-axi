import type { Run } from "../state/run.ts";
import { coverage, executionStart, taskLimitations } from "./details.ts";
import { findings } from "./findings.ts";
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
      findings: findings(run).map(({ location, evidence, ...finding }) => ({
        ...finding,
        ...location,
        ...(evidence
          ? {
              evidence: {
                ...evidence.location,
                quote: evidence.quote,
              },
            }
          : {}),
      })),
      coverageBasis: "coordinator-assigned",
      coverage: run.tasks.map((t) =>
        coverage(
          t,
          context,
          status === "interrupted",
          true,
          executionStart(run),
        ),
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
