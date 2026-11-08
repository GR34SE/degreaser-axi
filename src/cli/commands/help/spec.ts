import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Show help for a command",
  usage: "help [command]",
  flags: {},
  positionals: {
    min: 0,
    max: 2,
  },
  examples: ["degreaser-axi help review", "degreaser-axi help setup hooks"],
};
