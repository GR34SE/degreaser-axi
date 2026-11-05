import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { processAlive } from "../src/ownership.ts";
import type { Run } from "../src/storage.ts";

function read(path: string): Run | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Stops every run in a disposable repository through the public, ownership-
 * verified `cancel` command run by this Node executable with `args`. Returns run IDs whose stop could not be
 * confirmed; callers must then keep the repository as evidence.
 */
export function stopRuns(cwd: string, args: string[], timeout = 60_000) {
  const runs = join(cwd, ".degreaser/runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs).filter((id) => {
    const path = join(runs, id, "run.json");
    const before = read(path);
    if (before && before.status !== "running") return false;
    const result = spawnSync(process.execPath, [...args, "cancel", id], {
      cwd,
      encoding: "utf8",
      timeout,
    });
    const run = read(path);
    const terminal =
      run !== undefined &&
      (run.status !== "running" || !run.owner || !processAlive(run.owner.pid));
    return !(
      result.error === undefined &&
      (result.status === 0 || result.status === 1) &&
      terminal
    );
  });
}
