import type { AspectId } from "../../modules/aspect/api.ts";

export interface Location {
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
}
export interface Quoted {
  location: Location;
  quote: string;
}
export interface Candidate extends Quoted {
  title: string;
}
export interface Finding extends Candidate {
  verdict: "upheld" | "refuted" | "unverified";
  action?: string;
  reason?: string;
  evidence?: Quoted;
}
export interface FinderResult {
  aspect: AspectId;
  status: "findings" | "no-findings" | "not-applicable" | "incomplete";
  findings: Candidate[];
  kept?: Quoted[];
  limitations: string[];
  reason?: string;
}
export interface VerifierResult {
  aspect: AspectId;
  status: "verdicts" | "incomplete";
  verdicts: {
    candidate: number;
    verdict: "upheld" | "refuted";
    reason: string;
    action?: string;
    evidence?: Quoted;
  }[];
  limitations: string[];
}
export interface WorkerResult {
  aspect: AspectId;
  status: FinderResult["status"];
  findings: Finding[];
  kept?: Quoted[];
  limitations: string[];
  reason?: string;
  examinedPaths?: string[];
}
export interface Rejection {
  index: number;
  reason:
    | "path-not-assessed"
    | "side-unavailable"
    | "source-unavailable"
    | "range-out-of-bounds"
    | "quote-mismatch";
}
