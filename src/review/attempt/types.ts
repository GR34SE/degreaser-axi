import type { AcpRuntimeUsageBreakdown } from "acpx/runtime";
import type {
  WorkerDiagnostic,
  WorkerFailure,
} from "../../review/attempt/failure.ts";

export interface WorkerRequest {
  cwd: string;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  idleMs?: number;
  onActivity?: () => void;
  signal?: AbortSignal;
  onPromptStarted?: () => void;
  onSessionReady?: (id: string) => void;
  onLifecycle?: (event: { type: "spawn" | "exit"; pid: number }) => void;
  onTool?: (event: { kind: string; status: string }) => void;
}
export interface WorkerOutcome {
  status: "completed" | "failed";
  model: string;
  sessionId?: string;
  output: string;
  failure?: WorkerFailure;
  diagnostic?: WorkerDiagnostic;
  stopReason?: string;
  cleanupFailed: boolean;
  usage: AcpRuntimeUsageBreakdown | null;
  limitations: string[];
}
