import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { processAlive } from "../src/ownership.ts";
import { loadRun } from "../src/storage.ts";

async function ownerExited(cwd: string, id: string, deadline: number) {
  for (;;) {
    let pid: number | undefined;
    try {
      pid = loadRun(cwd, id).owner?.pid;
    } catch {
      return false;
    }
    if (pid === undefined || !processAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await setTimeout(50);
  }
}

/**
 * Stops every run in a disposable repository through the public, ownership-
 * verified `cancel` command run by this Node executable with `args`, then
 * waits for the recorded owner to exit. Returns run IDs whose stop could not
 * be confirmed; callers must then keep the repository as evidence.
 */
export async function stopRuns(cwd: string, args: string[], timeout = 60_000) {
  const runs = join(cwd, ".degreaser/runs");
  if (!existsSync(runs)) return [];
  const unconfirmed: string[] = [];
  for (const id of readdirSync(runs)) {
    const result = spawnSync(process.execPath, [...args, "cancel", id], {
      cwd,
      encoding: "utf8",
      timeout,
    });
    const cancelled =
      result.error === undefined &&
      (result.status === 0 || result.status === 1);
    if (!(cancelled && (await ownerExited(cwd, id, Date.now() + timeout))))
      unconfirmed.push(id);
  }
  return unconfirmed;
}
