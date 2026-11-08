import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Agent integration commands",
  usage: "setup hooks [options]",
  flags: {},
  positionals: {
    min: 1,
    max: 1,
  },
  examples: [
    "degreaser-axi setup hooks --help",
    "degreaser-axi setup hooks --harnesses codex",
  ],
};
