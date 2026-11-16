import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Continue unfinished aspects of an unchanged review",
  usage:
    "resume <run-id> [--concurrency <n>] [--wait <seconds>] [--deadline <seconds>]",
  flags: {
    concurrency: {
      type: "string",
      description:
        "Positive active-worker cap (default the run's last cap, else twice the selected aspect count)",
    },
    wait: {
      type: "string",
      description:
        "Return status running after this many seconds (default: block until the run ends, or 60 seconds past its deadline)",
    },
    deadline: {
      type: "string",
      description:
        "Explicit new deadline duration from resume (default retain original)",
    },
  },
  positionals: {
    min: 1,
    max: 1,
  },
  examples: [
    "degreaser-axi resume <run-id>",
    "degreaser-axi resume <run-id> --concurrency 1",
  ],
};
