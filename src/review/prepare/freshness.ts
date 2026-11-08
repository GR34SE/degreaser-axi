import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config/load.ts";
import { resolveConfig } from "../../config/resolve.ts";
import { ASPECT_IDS } from "../../modules/aspect/api.ts";
import { reviewIdentity } from "../../state/identity.ts";
import type { Run } from "../../state/run.ts";
import { InputError, StateError } from "../../util/errors.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { assemblePrompt } from "../attempt/prompt/assemble.ts";
import type { ReviewInput } from "../types.ts";
import { reviewCommand } from "./index.ts";
import { resolveScope } from "./scope/resolve.ts";

export function assertFresh(runtime: Runtime, run: Run, input: ReviewInput) {
  try {
    const config = resolveConfig(
      loadConfig(run.repository),
      {
        aspects: input.config.assignments.map((a) => a.aspect),
      },
      ASPECT_IDS,
    );
    const fresh = {
      ...input,
      config,
      task: input.taskFile
        ? new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(input.taskFile),
          )
        : input.task,
      ...resolveScope(
        runtime,
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
