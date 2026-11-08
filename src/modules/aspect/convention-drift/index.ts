import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "convention-drift",
  title: "Convention Drift",
  summary:
    "Does this introduce another way to do the same thing without a reason?",
  applicability: "paths",
  boundaries: [
    {
      other: "structural-erosion",
      rule: "Convention divergence versus increased coupling in one unit.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
