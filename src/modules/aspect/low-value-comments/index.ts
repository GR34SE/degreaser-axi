import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "low-value-comments",
  title: "Low Value Comments",
  summary: "Does the comment explain something the code cannot?",
  applicability: "paths",
  boundaries: [
    {
      other: "contract-bypass",
      rule: "Type/lint suppression comments belong to contract bypass.",
      reciprocal: false,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
