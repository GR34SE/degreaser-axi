import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description:
    "Check configuration, integrations and native versions without model calls",
  usage: "doctor",
  flags: {},
  positionals: {
    min: 0,
    max: 0,
  },
  examples: ["degreaser-axi doctor", "degreaser-axi doctor --help"],
};
