import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Show configuration and the latest review",
  usage: "home",
  flags: {},
  positionals: {
    min: 0,
    max: 0,
  },
  examples: ["degreaser-axi", "degreaser-axi home"],
};
