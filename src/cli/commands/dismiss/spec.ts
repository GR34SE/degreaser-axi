import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description: "Record a finding the user decided not to apply",
  usage: "dismiss <finding-id> --reason <text> [--run <run-id>]",
  flags: {
    reason: {
      type: "string",
      description: "Required: why the user decided not to apply it",
    },
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
    'degreaser-axi dismiss F3 --reason "The user keeps this fallback for old clients"',
  ],
};
