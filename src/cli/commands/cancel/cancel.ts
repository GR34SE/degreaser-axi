import { cancelReview } from "../../../review/index.ts";
import { loadRun } from "../../../state/store.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import { completenessCode } from "../../exit-codes.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";
import { waitFor } from "../shared/run.ts";

export { spec } from "./spec.ts";

export async function run(f: Factory, { positionals }: CommandOptions) {
  const run = loadRun(repositoryRoot(f, f.cwd), positionals[0]);
  const output = await waitFor(f, await cancelReview(run), 480);
  return { output, exitCode: completenessCode(output.status) };
}
