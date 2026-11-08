import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "scope-creep",
  title: "Scope Creep",
  summary: "Did the change add features or refactoring outside the task?",
  applicability: "task",
  boundaries: [
    {
      other: "incomplete-integration",
      rule: "Unrequested code versus required but disconnected code.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
