import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Stop a running review, keeping finished results",
  usage: "cancel <run-id>",
  flags: {},
  positionals: {
    min: 1,
    max: 1,
  },
  examples: ["degreaser-axi cancel <run-id>", "degreaser-axi cancel --help"],
};
