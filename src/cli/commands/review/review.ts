import { configNotice } from "../../../config/defaults.ts";
import { lowerConfiguredLimits } from "../../../config/limits.ts";
import { ASPECT_IDS } from "../../../modules/aspect/api.ts";
import { startReview } from "../../../review/index.ts";
import { prepareReview } from "../../../review/prepare/index.ts";
import { completenessCode } from "../../exit-codes.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";
import { identities, waitFor } from "../shared/run.ts";
import { parseReviewArguments } from "./arguments.ts";

export { spec } from "./spec.ts";

export async function run(f: Factory, options: CommandOptions) {
  const input = prepareReview(
    f,
    parseReviewArguments(options, f.cwd),
    f.cwd,
    f.config,
  );
  const rc = f.config(input.repository);
  const notice = configNotice(rc, ASPECT_IDS);
  for (const limit of lowerConfiguredLimits(
    rc,
    input.config.assignments.length,
  ))
    f.io.error.write(
      `warning: ${limit.field}=${limit.value} is below the default ${limit.default}. Keep the explicit limit or remove it to use the default; degreaser-axi config sync lists suggested removals.\n`,
    );
  const { run, versionNotices } = await startReview(f, input);
  if (!run)
    return {
      output: {
        ...notice,
        status: "no-changes",
        scope: input.scope,
        task: input.task,
        reason:
          "No change was reviewed. No reviewer was started; this is not a repository audit or a model quality verdict.",
      },
    };
  const workers = run.tasks.filter((t) => t.promptHash !== null);
  f.io.error.write(
    `run: ${run.id}; aspects: ${run.tasks.length}; finder sessions: ${workers.length}; verifier sessions: up to ${workers.length}; finders: ${identities(workers) || "coordinator-only"}; verifier: ${input.config.verifier.agent}/${input.config.verifier.model}; concurrency: ${input.config.concurrency}; deadline: ${new Date(run.deadline).toISOString()}\n`,
  );
  const output = await waitFor(f, run, input.waitSeconds);
  return {
    output: {
      ...output,
      ...notice,
      ...(versionNotices.length ? { nativeVersionNotice: versionNotices } : {}),
    },
    exitCode: completenessCode(output.status),
  };
}
