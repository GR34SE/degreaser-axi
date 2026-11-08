import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "low-value-tests",
  title: "Low Value Tests",
  summary:
    "Would this test detect broken behavior, or just confirm its own mock?",
  boundaries: [
    {
      other: "verification-theater",
      rule: "Test-runner-only verification versus other verification.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
