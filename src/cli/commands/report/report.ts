import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

import { skippedNote } from "../../../install/startup-context.ts";
import { renderReport } from "../../../report/index.ts";
import { completenessCode } from "../../exit-codes.ts";
import { reportContext, selectRun } from "../shared/run.ts";
export function run(f: Factory, { positionals, values }: CommandOptions) {
  const selected = selectRun(repositoryRoot(f, f.cwd), positionals[0]);
  const { run, context } = reportContext(f, selected.run);
  const output = renderReport(run, context, values.full === true);
  const note = skippedNote(selected.skipped);
  return {
    output: { ...output, ...(note ? { skippedRuns: note } : {}) },
    exitCode: completenessCode(output.status),
  };
}
