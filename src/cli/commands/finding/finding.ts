import { loadRun } from "../../../state/store.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

import { renderFinding } from "../../../report/index.ts";
import { reportContext } from "../shared/run.ts";
export function run(f: Factory, { positionals, values }: CommandOptions) {
  const { run, context } = reportContext(
    f,
    loadRun(
      repositoryRoot(f, f.cwd),
      typeof values.run === "string" ? values.run : undefined,
    ),
  );
  return { output: renderFinding(run, context, positionals[0]) };
}
