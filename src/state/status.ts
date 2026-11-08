import { ownerAlive } from "./ownership.ts";
import type { Run } from "./run.ts";
import { loadRun } from "./store.ts";

function snapshotStatus(run: Run): Run["status"] | "interrupted" {
  if (run.status !== "running") return run.status;
  if (!run.owner)
    return Date.now() - run.createdAt < 10_000 ? "running" : "interrupted";
  return ownerAlive(run.owner) ? "running" : "interrupted";
}

/**
 * The owner persists its terminal record before exiting, so a record read
 * before the owner was seen gone is reread: only a record read afterwards can
 * show an interruption.
 */
export function observeRun(run: Run) {
  const status = snapshotStatus(run);
  if (status !== "interrupted" || run.status !== "running")
    return { run, status };
  const current = loadRun(run.repository, run.id);
  return { run: current, status: snapshotStatus(current) };
}
