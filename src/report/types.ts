import type { Run, RunInput } from "../state/run.ts";

export interface ReportContext {
  input: RunInput;
  status: Run["status"] | "interrupted";
  unverifiedOwner: boolean;
  now: number;
  harnessLimitations: Record<string, readonly string[]>;
  ownerRecovery: string;
  reviewCommand: string;
}
