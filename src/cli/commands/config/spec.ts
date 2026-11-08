import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Project configuration commands",
  usage: "config sync",
  flags: {},
  positionals: {
    min: 1,
    max: 1,
  },
  examples: ["degreaser-axi config sync", "degreaser-axi config sync --help"],
};
