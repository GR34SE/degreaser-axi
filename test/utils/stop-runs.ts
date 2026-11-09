import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { processAlive } from "../../src/state/ownership.ts";
import { loadRun } from "../../src/state/store.ts";

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
