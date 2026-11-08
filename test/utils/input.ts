import { parseReviewArguments } from "../../src/cli/commands/review/arguments.ts";
import { spec } from "../../src/cli/commands/review/spec.ts";
import { parseCommand } from "../../src/cli/parse.ts";
import { prepareReview as prepare } from "../../src/review/prepare/index.ts";
import { runtime } from "./runtime.ts";

export function prepareReview(args: string[], cwd: string) {
  return prepare(
    runtime(),
    parseReviewArguments(parseCommand("review", spec, args), cwd),
    cwd,
  );
}
