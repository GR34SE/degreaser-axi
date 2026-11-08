import { createRun as persistRun } from "../../state/create.ts";
import type { RunTask } from "../../state/run.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { assemblePrompt } from "../attempt/prompt/assemble.ts";
import type { ReviewInput } from "../types.ts";

export function createRun(runtime: Runtime, input: ReviewInput) {
  return persistRun(
    runtime,
    input,
    (patchFile) => {
      const tasks: RunTask[] = input.config.assignments.map((assignment) => {
        const result =
          input.coordinatorResults.find(
            (r) => r.aspect === assignment.aspect,
          ) ?? null;
        return {
          assignment,
          promptHash: result
            ? null
            : assemblePrompt(input, assignment.aspect, patchFile).promptHash,
          status: result?.status ?? "pending",
          result,
          rejections: [],
          attempts: [],
          limitations: [],
          usage: null,
        };
      });
      return tasks;
    },
    runtime.now,
  );
}
