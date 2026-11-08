import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "wrong-abstraction",
  title: "Wrong Abstraction",
  summary: "Does a shared mechanism combine cases with conflicting rules?",
  boundaries: [
    {
      other: "structural-erosion",
      rule: "Divergent cases in one mechanism versus scattered rules in an overloaded unit.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
