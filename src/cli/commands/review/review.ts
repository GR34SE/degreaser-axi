import { configNotice } from "../../../config/defaults.ts";
import { ASPECT_IDS } from "../../../modules/aspect/api.ts";
import { startReview } from "../../../review/index.ts";
import { prepareReview } from "../../../review/prepare/index.ts";
import { completenessCode } from "../../exit-codes.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";
import { waitFor } from "../shared/run.ts";
import { parseReviewArguments } from "./arguments.ts";

export { spec } from "./spec.ts";

export async function run(f: Factory, options: CommandOptions) {
  const input = prepareReview(
    f,
    parseReviewArguments(options, f.cwd),
    f.cwd,
    f.config,
  );
  const notice = configNotice(f.config(input.repository), ASPECT_IDS);
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
  f.io.error.write(
    `run: ${run.id}; workers: ${input.workers.length}; identities: ${[...new Set(input.workers.map((w) => `${w.agent}/${w.model}`))].join(",") || "coordinator-only"}; concurrency: ${input.config.concurrency ?? "all"}; deadline: ${new Date(run.deadline).toISOString()}\n`,
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
