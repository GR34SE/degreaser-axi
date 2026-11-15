import type { Run } from "../state/run.ts";
import { StateError } from "../util/errors.ts";
import { shownLimitations, taskLimitations } from "./details.ts";
import { findings } from "./findings.ts";
import { present } from "./present.ts";
import type { ReportContext } from "./types.ts";

export function renderFinding(
  run: Run,
  context: ReportContext,
  id: string | undefined,
) {
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
    ...present(finding),
    aspectStatus: task.status,
    limitations: [
      ...shownLimitations(context.input, false),
      ...taskLimitations(task),
    ],
    rejections: task.rejections,
  };
}
