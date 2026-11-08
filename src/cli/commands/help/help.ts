import { AxiError } from "axi-sdk-js";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";
export function run(f: Factory, { positionals }: CommandOptions) {
  const target = positionals.join(" ");
  if (target && !f.commandNames.includes(target))
    throw new AxiError(`Unknown command: ${target}`, "VALIDATION_ERROR", [
      String(f.help("")),
    ]);
  return { output: f.help(target) };
}
