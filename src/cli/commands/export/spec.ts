import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Print a review as JSON for other tools",
  usage: "export [run-id]",
  flags: {},
  positionals: {
    min: 0,
    max: 1,
  },
  examples: [
    "degreaser-axi export > degreaser.json",
    "degreaser-axi export <run-id>",
  ],
};
