import { AGENTS } from "../../../modules/harness/api.ts";
import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
  description:
    "Choose the review and verifier models and install agent integrations",
  usage:
    "init --agent <agent> --model <model> [--verifier-model <model>] --harnesses <targets>",
  flags: {
    agent: {
      type: "string",
      description: `Confirmed worker agent: ${AGENTS.join(", ")}`,
    },
    model: {
      type: "string",
      description:
        "Confirmed model ID or listed latest selector; required on every init",
    },
    "verifier-agent": {
      type: "string",
      description: `Confirmed verifier agent: ${AGENTS.join(", ")}; defaults to --agent`,
    },
    "verifier-model": {
      type: "string",
      description:
        "Optional verifier model ID or latest selector; omit verifier flags to inherit the finder model",
    },
    harnesses: {
      type: "string",
      description: `Comma-separated ${AGENTS.join(",")}; explicit selection required`,
    },
    "installation-scope": {
      type: "string",
      description: "project (default) or explicit user installation",
    },
    "skill-install": {
      type: "string",
      description:
        "copy (default) or link: Claude's skill as a symlink to the codex/pi .agents/skills copy",
    },
  },
  positionals: {
    min: 0,
    max: 0,
  },
  examples: [
    "degreaser-axi init",
    "degreaser-axi init --agent codex --model <confirmed-model> --verifier-model <confirmed-model> --harnesses codex",
  ],
};
