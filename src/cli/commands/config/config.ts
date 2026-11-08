import { AxiError } from "axi-sdk-js";
import type { Factory } from "../../factory.ts";
import type { CommandOptions, CommandResult } from "../../types.ts";

export { spec } from "./spec.ts";
export function run(_f: Factory, options: CommandOptions): CommandResult {
  throw new AxiError(
    `Unknown config command: ${options.positionals[0]}`,
    "VALIDATION_ERROR",
    ["degreaser-axi config sync --help"],
  );
}
