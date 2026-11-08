import type { AspectMeta } from "../types.ts";

export const meta = {
  id: "verification-theater",
  title: "Verification Theater",
  summary:
    "Does a runtime or tooling check prove the property it claims to verify?",
  applicability: "paths",
  boundaries: [],
} as const satisfies AspectMeta;

export const rubric = new URL("./rubric.md", import.meta.url);
