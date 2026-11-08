import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "unnecessary-layers",
  title: "Unnecessary Layers",
  summary:
    "Does this wrapper, service or factory add useful behavior or a boundary?",
  applicability: "paths",
  boundaries: [
    {
      other: "speculative-flexibility",
      rule: "Behaviorless layer versus unused variant.",
      reciprocal: true,
    },
    {
      other: "wrong-abstraction",
      rule: "Behaviorless layer versus used cases with conflicting rules.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
