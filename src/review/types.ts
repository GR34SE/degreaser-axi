import type {
  Assignment,
  EffectiveConfig,
  ReviewControls,
} from "../config/types.ts";
import type { Dismissal } from "../state/dismissal.ts";
import type { WorkerResult } from "./ingest/types.ts";
import type { ResolvedScope, Scope } from "./prepare/scope/types.ts";

export interface ReviewRequest {
  scope: Scope;
  baseRef: string | undefined;
  task: string;
  taskFile?: string;
  pathPatterns: string[];
  controls: ReviewControls;
  waitSeconds: number;
}

export interface ReviewInput extends ResolvedScope {
  schemaVersion: 1;
  status: "no-changes" | "ready";
  repository: string;
  scope: Scope;
  baseRef: string | null;
  task: string;
  taskFile?: string;
  pathPatterns?: string[];
  waitSeconds: number;
  config: EffectiveConfig;
  dismissed?: Dismissal[];
  workers: Assignment[];
  coordinatorResults: WorkerResult[];
}

export interface ResumeControls {
  concurrency?: number;
  waitSeconds?: number;
  deadlineSeconds?: number;
}
