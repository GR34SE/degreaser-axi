import type { AcpRuntimeUsageBreakdown } from "acpx/runtime";
import type {
  WorkerDiagnostic,
  WorkerFailure,
} from "../../review/attempt/failure.ts";

export interface WorkerRequest {
  cwd: string;
  /** Assembled assignment, task/scope and response contract. Never ambient caller history. */
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  /** Stop the attempt after this long without any adapter event. */
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
  /** Stage and safe machine codes of a failed attempt; absent when nothing failed. */
  diagnostic?: WorkerDiagnostic;
  /** Native stop reason of a finished turn, when one was reported. */
  stopReason?: string;
  cleanupFailed: boolean;
  usage: AcpRuntimeUsageBreakdown | null;
  limitations: string[];
}
