import type { parseArgs } from "node:util";
import type { Factory } from "./factory.ts";

export interface Flag {
  type: "string" | "boolean";
  multiple?: boolean;
  description: string;
}
export interface CommandSpec {
  description: string;
  usage: string;
  flags: Record<string, Flag>;
  positionals: { min: number; max: number };
  examples: string[];
}
export type CommandOptions = ReturnType<typeof parseArgs>;
export interface CommandResult {
  output: string | Record<string, unknown>;
  exitCode?: number;
}
export interface Command {
  spec: CommandSpec;
  run: (
    factory: Factory,
    options: CommandOptions,
  ) => CommandResult | Promise<CommandResult>;
}
