import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "verification-theater",
  title: "Verification Theater",
  summary:
    "Does the check distinguish the valid and invalid states it claims to verify?",
  boundaries: [],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
