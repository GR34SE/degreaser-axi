import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

import { exportRun } from "../../../report/index.ts";
import { reportContext, selectRun } from "../shared/run.ts";
export function run(f: Factory, { positionals }: CommandOptions) {
  const { run, context } = reportContext(
    f,
    selectRun(repositoryRoot(f, f.cwd), positionals[0]).run,
  );
  return { output: exportRun(run, context) };
}
