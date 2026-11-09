import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "reinvented-infrastructure",
  title: "Reinvented Infrastructure",
  summary:
    "Does a handwritten cache, parser or similar mechanism miss required semantics?",
  boundaries: [],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
