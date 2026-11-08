import { ownerAlive } from "./ownership.ts";
import type { Run } from "./run.ts";

export function observedStatus(run: Run) {
  if (run.status !== "running") return run.status;
  if (!run.owner)
    return Date.now() - run.createdAt < 10_000 ? "running" : "interrupted";
  return ownerAlive(run.owner) ? "running" : "interrupted";
}
