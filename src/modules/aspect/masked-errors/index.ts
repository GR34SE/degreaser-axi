import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "masked-errors",
  title: "Masked Errors",
  summary: "Does a fallback turn failure into apparent success?",
  applicability: "paths",
  boundaries: [
    {
      other: "unjustified-defense",
      rule: "Result of actual error handling versus redundant checking.",
      reciprocal: true,
    },
    {
      other: "contract-bypass",
      rule: "Error turned into success versus suppressed contract mismatch.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
