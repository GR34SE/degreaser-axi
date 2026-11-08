import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "unnecessary-complexity",
  title: "Unnecessary Complexity",
  summary: "Is this the simplest implementation possible?",
  applicability: "paths",
  boundaries: [
    {
      other: "unnecessary-layers",
      rule: "Excess mechanism inside an implementation versus a behaviorless layer.",
      reciprocal: true,
    },
    {
      other: "speculative-flexibility",
      rule: "Excess mechanism for current requirements versus unused variants.",
      reciprocal: true,
    },
    {
      other: "wrong-abstraction",
      rule: "Excess mechanism for one case versus divergent cases sharing a mechanism.",
      reciprocal: true,
    },
    {
      other: "unidiomatic-code",
      rule: "Algorithm or control-flow design versus an expression-level native construct.",
      reciprocal: true,
    },
    {
      other: "structural-erosion",
      rule: "Excess mechanism for one responsibility versus added responsibilities or coupling.",
      reciprocal: true,
    },
    {
      other: "unjustified-defense",
      rule: "Excess main logic versus redundant checks and handlers.",
      reciprocal: true,
    },
    {
      other: "missed-reuse",
      rule: "Simpler own implementation versus an existing equivalent.",
      reciprocal: true,
    },
  ],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
