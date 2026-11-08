import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { loadConfig } from "../config/load.ts";
import type { ProjectConfig } from "../config/types.ts";
import type { Runtime } from "../util/exec/types.ts";
import { type IO, processIO } from "./io.ts";

export interface Factory extends Runtime {
  cwd: string;
  bin: string;
  commandNames: string[];
  help: (target: string) => string | Record<string, unknown>;
  io: IO;
  config: (repository: string) => ProjectConfig;
  signals: Pick<NodeJS.Process, "on" | "off" | "once" | "removeListener">;
}

export function createFactory(overrides: Partial<Factory> = {}): Factory {
  return {
    cwd: process.cwd(),
    bin: process.argv[1] ?? "",
    commandNames: [],
    help: () => {
      throw new Error("Command help is not initialized.");
    },
    env: { ...process.env },
    executable: process.execPath,
    arguments: [...process.execArgv],
    home: homedir(),
    now: Date.now,
    spawn,
    spawnSync,
    io: processIO(),
    config: loadConfig,
    signals: process,
    ...overrides,
  };
}
