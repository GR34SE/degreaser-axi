import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "missed-reuse",
  title: "Missed Reuse",
  summary: "Does the repo or an existing dependency already solve this?",
  applicability: "paths",
  boundaries: [
    {
      other: "reinvented-infrastructure",
      rule: "Existing equivalent versus missing general-purpose solution.",
      reciprocal: true,
    },
    {
      other: "unidiomatic-code",
      rule: "Contracted component versus expression-level native construct.",
      reciprocal: true,
    },
    {
      other: "convention-drift",
      rule: "Reimplemented mechanism versus convention divergence.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
