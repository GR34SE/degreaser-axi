import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Wait for a running review to finish",
  usage: "wait <run-id> [--wait <seconds>]",
  flags: {
    wait: {
      type: "string",
      description:
        "Return status running after this many seconds (default: block until the run ends)",
    },
  },
  positionals: {
    min: 1,
    max: 1,
  },
  examples: [
    "degreaser-axi wait <run-id>",
    "degreaser-axi wait <run-id> --wait 30",
  ],
};
