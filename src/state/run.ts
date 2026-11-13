import type { ReviewInput } from "../review/types.ts";
export type RunInput = ReviewInput;

import type { ProcessIdentity } from "../util/exec/types.ts";

export type { ProcessIdentity } from "../util/exec/types.ts";

import type { Assignment } from "../config/types.ts";
import type { WorkerDiagnostic } from "../review/attempt/failure.ts";
import type { Rejection, WorkerResult } from "../review/ingest/types.ts";

export interface RunTask {
  assignment: Assignment;
  promptHash: string | null;
  status:
    | "pending"
    | "running"
    | "failed"
    | "cancelled"
    | WorkerResult["status"];
  result: WorkerResult | null;
  rejections: Rejection[];
  attempts: {
    startedAt: number;
    endedAt: number | null;
    sessionId: string | null;
    lastActivityAt?: number;
    failure: string | null;
    diagnostic?: WorkerDiagnostic;
    result?: WorkerResult | null;
    rejections?: Rejection[];
    limitations?: string[];
    usage?: Record<string, number> | null;
    portion?: { index: number; paths: number };
  }[];
  limitations: string[];
  unresolved?: { cause: string; paths: string[]; stuck?: string[] };
  usage: Record<string, number> | null;
}
export interface Run {
  schemaVersion: 1;
  id: string;
  repository: string;
  createdAt: number;
  deadline: number;
  status: "running" | "completed" | "partial" | "failed";
  owner: {
    pid: number;
    heartbeat: number;
    started?: string;
    processes?: ProcessIdentity[];
  } | null;
  executions?: {
    startedAt: number;
    deadline: number;
    concurrency: number | null;
    waitSeconds: number;
    stopReason?: "cancelled" | "deadline";
    failure?: { code: string; message: string };
  }[];
  identity: string;
  tasks: RunTask[];
}
export const resolved = (task: RunTask) =>
  ["findings", "no-findings", "not-applicable"].includes(task.status);
export function terminalStatus(tasks: RunTask[]): Run["status"] {
  return tasks.every(resolved)
    ? "completed"
    : tasks.some((t) => t.promptHash !== null && t.result)
      ? "partial"
      : "failed";
}
