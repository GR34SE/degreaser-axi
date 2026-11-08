import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Print the version",
  usage: "version",
  flags: {},
  positionals: {
    min: 0,
    max: 0,
  },
  examples: ["degreaser-axi --version", "degreaser-axi version"],
};
