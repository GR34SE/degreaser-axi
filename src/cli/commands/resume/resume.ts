import { resumeReview } from "../../../review/index.ts";
import type { ResumeControls } from "../../../review/types.ts";
import { resolved } from "../../../state/run.ts";
import { loadRun } from "../../../state/store.ts";
import { InputError } from "../../../util/errors.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import { completenessCode } from "../../exit-codes.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";
import { positiveInteger } from "../review/arguments.ts";
import { identities, waitFor } from "../shared/run.ts";

export { spec } from "./spec.ts";

export async function run(f: Factory, { values, positionals }: CommandOptions) {
  const controls: ResumeControls = {
    waitSeconds:
      values.wait === undefined
        ? 480
        : positiveInteger(String(values.wait), "--wait", 2147483),
  };
  for (const [flag, key, maximum] of [
    ["concurrency", "concurrency", Number.MAX_SAFE_INTEGER],
    ["deadline", "deadlineSeconds", 2147483],
  ] as const) {
    if (values[flag] === undefined) continue;
    if (typeof values[flag] !== "string")
      throw new InputError(`--${flag} requires a positive integer.`);
    controls[key] = positiveInteger(values[flag], `--${flag}`, maximum);
  }
  const id = positionals[0] ?? "";
  const prior = loadRun(repositoryRoot(f, f.cwd), id);
  const resumed = await resumeReview(f, prior, controls);
  if (!resumed)
    return {
      output: {
        run: id,
        status: "already-completed",
        help: [`degreaser-axi report ${id}`],
      },
    };
  const unresolved = prior.tasks.filter((t) => !resolved(t));
  f.io.error.write(
    `run: ${id}; resume unresolved: ${unresolved.length}; identities: ${identities(unresolved)}; concurrency: ${resumed.executions?.at(-1)?.concurrency ?? "all"}; deadline: ${new Date(resumed.deadline).toISOString()}\n`,
  );
  const output = await waitFor(f, resumed, controls.waitSeconds ?? 480);
  return { output, exitCode: completenessCode(output.status) };
}
