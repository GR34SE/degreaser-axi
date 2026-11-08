import { AGENTS } from "../../../../modules/harness/api.ts";
import type { CommandSpec } from "../../../types.ts";

export const spec: CommandSpec = {
  description: "Install, repair or remove agent integrations",
  usage:
    "setup hooks --harnesses <targets> [--installation-scope project|user] [--remove]",
  flags: {
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
    remove: {
      type: "boolean",
      description: "Remove only Degreaser-owned integration entries",
    },
  },
  positionals: {
    min: 0,
    max: 0,
  },
  examples: [
    "degreaser-axi setup hooks --harnesses claude,pi",
    "degreaser-axi setup hooks --harnesses codex --remove",
  ],
};
