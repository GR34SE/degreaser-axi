import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "stale-references",
  title: "Stale References",
  summary:
    "Did the change leave repository text untrue, or silently drop a rule it did not ask to remove?",
  boundaries: [
    {
      other: "incomplete-integration",
      rule: "Text read by people or agents still describing removed or renamed things versus code-consumed references and required code not connected to the runtime path.",
      reciprocal: true,
    },
    {
      other: "low-value-comments",
      rule: "Text the change made false versus accurate narration that prevents no hidden trap.",
      reciprocal: true,
    },
    {
      other: "scope-creep",
      rule: "A rule silently dropped from rewritten text versus unrequested additions.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
