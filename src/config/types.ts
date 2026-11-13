import type { AspectId } from "../modules/aspect/api.ts";
import type { Agent } from "../modules/harness/api.ts";

export type { AspectId } from "../modules/aspect/api.ts";
export type { Agent } from "../modules/harness/api.ts";

export interface Identity {
  agent: Agent;
  model: string;
}
export interface Assignment extends Identity {
  aspect: AspectId;
  requestedModel?: string;
}
export interface Limits {
  workerTimeoutSeconds: number;
  workerIdleSeconds?: number;
  maxTurns: number;
  runTimeoutSeconds: number;
}
export type AspectSetting = boolean | { agent?: Agent; model: string };
export interface ProjectConfig extends Identity {
  schemaVersion?: 1;
  concurrency?: number | null;
  maxRetries?: number;
  limits?: Partial<Limits>;
  aspects?: Partial<Record<AspectId, AspectSetting>>;
  exclude?: string[];
}
export interface EffectiveConfig {
  assignments: Assignment[];
  concurrency: number | null;
  maxRetries: number;
  limits: Limits;
  exclude: string[];
}
export interface ReviewControls {
  aspects?: string[];
  concurrency?: number;
}
