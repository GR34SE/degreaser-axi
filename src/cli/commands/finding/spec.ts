import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Show one finding with its full evidence",
  usage: "finding <id> [--run <run-id>]",
  flags: {
    run: {
      type: "string",
      description: "Run ID (default latest run)",
    },
  },
  positionals: {
    min: 1,
    max: 1,
  },
  examples: [
    "degreaser-axi finding F1",
    "degreaser-axi finding F1 --run <run-id>",
  ],
};
