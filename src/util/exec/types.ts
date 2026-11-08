import type { spawn, spawnSync } from "node:child_process";

export interface Runtime {
  env: NodeJS.ProcessEnv;
  executable: string;
  arguments: string[];
  home: string;
  now: () => number;
  spawn: typeof spawn;
  spawnSync: typeof spawnSync;
}

export interface ProcessIdentity {
  pid: number;
  started: string;
  group: number;
}
