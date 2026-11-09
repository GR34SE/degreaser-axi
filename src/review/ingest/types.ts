import type { AspectId } from "../../modules/aspect/api.ts";

export interface Finding {
  location: {
    path: string;
    side: "old" | "new";
    startLine: number;
    endLine: number;
  };
  quote: string;
  title: string;
  evidence: string;
  consequence: string;
  countercheck: string;
  recommendation: string;
  uncertainty?: string;
}
export interface WorkerResult {
  aspect: AspectId;
  status: "findings" | "no-findings" | "not-applicable" | "incomplete";
  findings: Finding[];
  limitations: string[];
  reason?: string;
  examinedPaths?: string[];
  unresolved?: Unresolved[];
}
export interface Unresolved {
  scope: "paths" | "context" | "evidence" | "unspecified";
  reason: string;
  paths?: string[];
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
