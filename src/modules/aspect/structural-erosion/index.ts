import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "structural-erosion",
  title: "Structural Erosion",
  summary:
    "Does this change create or worsen coupling between responsibilities?",
  boundaries: [
    {
      other: "missed-reuse",
      rule: "Copies of existing code belong to failure to reuse.",
      reciprocal: false,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
