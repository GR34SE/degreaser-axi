import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Show a review's findings and coverage (default: latest run)",
  usage: "report [run-id] [--full]",
  flags: {
    full: {
      type: "boolean",
      description: "Show all findings and full evidence",
    },
  },
  positionals: {
    min: 0,
    max: 1,
  },
  examples: ["degreaser-axi report", "degreaser-axi report <run-id> --full"],
};
