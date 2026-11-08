import { parseArgs } from "node:util";
import { AxiError } from "axi-sdk-js";
import type { CommandSpec } from "./types.ts";

export function parseCommand(
  name: string,
  command: CommandSpec,
  args: string[],
) {
  const suggestions = [
    `Usage: degreaser-axi ${command.usage}`,
    `Valid flags: ${[...Object.keys(command.flags).map((flag) => `--${flag}`), "--help"].join(", ")}`,
  ];
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      tokens: true,
      strict: true,
      allowPositionals: true,
      options: { ...command.flags, help: { type: "boolean" } },
    });
  } catch (error) {
    throw new AxiError(
      `${name}: ${error instanceof Error ? error.message : "Invalid arguments"}`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  if (parsed.positionals.length > command.positionals.max) {
    throw new AxiError(
      `${name}: unexpected argument ${parsed.positionals[command.positionals.max]}`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  if (
    !parsed.values.help &&
    parsed.positionals.length < command.positionals.min
  ) {
    throw new AxiError(
      `${name}: missing required argument`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  return parsed;
}
