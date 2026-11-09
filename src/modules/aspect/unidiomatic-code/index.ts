import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "unidiomatic-code",
  title: "Unidiomatic Code",
  summary:
    "Can a native construct remove unnecessary logic without changing behavior?",
  boundaries: [],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
