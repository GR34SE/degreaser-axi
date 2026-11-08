import { loadRun } from "../../../state/store.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

import { exportRun } from "../../../report/index.ts";
import { reportContext } from "../shared/run.ts";
export function run(f: Factory, { positionals }: CommandOptions) {
  const run = loadRun(repositoryRoot(f, f.cwd), positionals[0]);
  return { output: exportRun(run, reportContext(f, run)) };
}
