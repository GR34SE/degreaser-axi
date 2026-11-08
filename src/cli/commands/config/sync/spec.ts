import type { CommandSpec } from "../../../types.ts";

export const spec: CommandSpec = {
  description: "Save missing default settings without changing existing ones",
  usage: "config sync",
  flags: {},
  positionals: {
    min: 0,
    max: 0,
  },
  examples: ["degreaser-axi config sync", "degreaser-axi config sync --help"],
};
