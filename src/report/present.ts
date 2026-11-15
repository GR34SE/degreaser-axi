import { type StoredFinding, where } from "./findings.ts";

export function present({ location, evidence, ...finding }: StoredFinding) {
  return {
    ...finding,
    location: where(location),
    ...(evidence
      ? { evidence: { at: where(evidence.location), quote: evidence.quote } }
      : {}),
  };
}
