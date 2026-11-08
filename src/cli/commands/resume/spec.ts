import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Continue unfinished aspects of an unchanged review",
  usage:
    "resume <run-id> [--concurrency <n>] [--wait <seconds>] [--deadline <seconds>]",
  flags: {
    concurrency: {
      type: "string",
      description: "Positive active-worker limit (default all enabled aspects)",
    },
    wait: {
      type: "string",
      description: "Seconds to wait (default 480)",
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
