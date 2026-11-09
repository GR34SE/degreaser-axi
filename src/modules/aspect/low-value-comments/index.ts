import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "low-value-comments",
  title: "Low Value Comments",
  summary: "Does the comment prevent a trap that code cannot reveal?",
  boundaries: [
    {
      other: "contract-bypass",
      rule: "Suppression effects belong to contract bypass; explanatory prose must still prevent a hidden trap.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
