import { loadRun } from "../../../state/store.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

import { renderReport } from "../../../report/index.ts";
import { completenessCode } from "../../exit-codes.ts";
import { reportContext } from "../shared/run.ts";
export function run(f: Factory, { positionals, values }: CommandOptions) {
  const { run, context } = reportContext(
    f,
    loadRun(repositoryRoot(f, f.cwd), positionals[0]),
  );
  const output = renderReport(run, context, values.full === true);
  return { output, exitCode: completenessCode(output.status) };
}
