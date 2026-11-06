import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveConfig } from "./config.ts";
import { type ReviewInput, reviewCommand } from "./input.ts";
import { InputError } from "./input-error.ts";
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
        input.pathPatterns,
      ),
    };
    const prompts = run.tasks.map((t) =>
      t.promptHash === null
        ? null
        : assemblePrompt(
            fresh,
            t.assignment.aspect,
            join(run.repository, ".degreaser/runs", run.id, "input/patch.diff"),
          ).promptHash,
    );
    if (reviewIdentity(fresh, prompts) === run.identity) return;
  } catch (error) {
    if (error instanceof StateError || error instanceof InputError) throw error;
    throw new StateError(
      "environment-blocked",
      `Freshness could not be checked. Check task-file and packaged prompt access/readability and local filesystem permissions, then retry degreaser-axi resume ${run.id}. Prior evidence is unchanged; no replacement work started.`,
    );
  }
  throw new StateError(
    "input-changed",
    `Review source, task, base, prompt, package fingerprint or selected agent/model changed. Prior evidence is unchanged. Start a new review: ${reviewCommand(input)}`,
  );
}
