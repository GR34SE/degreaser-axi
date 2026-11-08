import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "speculative-flexibility",
  title: "Speculative Flexibility",
  summary: "Do these options and extension points serve a current requirement?",
  boundaries: [
    {
      other: "wrong-abstraction",
      rule: "Unused variant versus used cases with conflicting rules.",
      reciprocal: true,
    },
    {
      other: "scope-creep",
      rule: "Internal flexibility versus unrequested product functionality.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
