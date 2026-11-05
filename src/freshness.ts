import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveConfig } from "./config.ts";
import type { ReviewInput } from "./input.ts";
import { assemblePrompt, reviewIdentity } from "./prompt.ts";
import { resolveScope } from "./scope.ts";
import { type Run, StateError } from "./storage.ts";

export function assertFresh(run: Run, input: ReviewInput) {
  try {
    const config = resolveConfig(loadConfig(run.repository), {
      aspects: input.config.assignments.map((a) => a.aspect),
    });
    const fresh = {
      ...input,
      config,
      task: input.taskFile
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(input.taskFile),
          )
        : input.task,
      ...resolveScope(
        run.repository,
        input.scope,
        input.baseRef ?? undefined,
        config.exclude,
      ),
    };
    const prompts = run.tasks.map((t) =>
      t.promptHash === null
        ? null
        : assemblePrompt(
            fresh,
            t.assignment.aspect,
            join(run.repository, ".degreaser/runs", run.id, "input/patch.json"),
          ).promptHash,
    );
    if (reviewIdentity(fresh, prompts) === run.identity) return;
  } catch {
    // A missing task/ref/rubric is changed review input, not a heartbeat failure.
  }
  throw new StateError(
    "input-changed",
    `Review source, task, base, prompt, package fingerprint or selected agent/model changed. Prior evidence is unchanged. Start a new review: degreaser-axi review --scope ${input.scope}${input.baseRef ? ` --base ${JSON.stringify(input.baseRef)}` : ""} ${input.taskFile ? `--task-file ${JSON.stringify(input.taskFile)}` : `--task ${JSON.stringify(input.task)}`}`,
  );
}
