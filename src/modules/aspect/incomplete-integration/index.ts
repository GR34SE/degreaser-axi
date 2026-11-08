import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "incomplete-integration",
  title: "Incomplete Integration",
  summary: "Is the new code connected to the real user path?",
  applicability: "paths",
  boundaries: [],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
