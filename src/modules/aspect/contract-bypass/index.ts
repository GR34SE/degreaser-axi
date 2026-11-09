import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "contract-bypass",
  title: "Contract Bypass",
  summary: "Does a cast, suppression or default hide a real mismatch?",
  boundaries: [],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
