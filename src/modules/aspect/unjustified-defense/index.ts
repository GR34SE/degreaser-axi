import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "unjustified-defense",
  title: "Unjustified Defense",
  summary: "Does this check protect a real boundary or possible state?",
  applicability: "paths",
  boundaries: [
    {
      other: "contract-bypass",
      rule: "Excess validation versus missing validation.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
