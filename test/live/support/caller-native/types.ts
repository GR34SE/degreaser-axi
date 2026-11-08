import type { CallerEvidence } from "../caller-evidence.ts";

export interface NativeCallerContext {
  model: string;
  cwd: string;
  prompt: string;
  trace: CallerEvidence;
  observe: (event: Record<string, unknown>) => void;
  phase: "context" | "review";
  extraEnvironment: Record<string, string>;
  executable: string;
  launcher: string;
  nativeVersion: string;
}
