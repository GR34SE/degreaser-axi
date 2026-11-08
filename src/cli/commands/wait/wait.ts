import { loadRun } from "../../../state/store.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

import { completenessCode } from "../../exit-codes.ts";
import { positiveInteger } from "../review/arguments.ts";
import { waitFor } from "../shared/run.ts";
export async function run(f: Factory, { positionals, values }: CommandOptions) {
  const run = loadRun(repositoryRoot(f, f.cwd), positionals[0]);
  const seconds =
    values.wait === undefined
      ? 480
      : positiveInteger(String(values.wait), "--wait", 2147483);
  const output = await waitFor(f, run, seconds);
  return { output, exitCode: completenessCode(output.status) };
}
