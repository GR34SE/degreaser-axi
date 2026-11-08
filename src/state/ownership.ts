import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { StateError } from "../util/errors.ts";
import { processTable } from "../util/exec/process-table.ts";
import type { ProcessIdentity, Run } from "./run.ts";
import { statePath } from "./store.ts";

export const ownerPath = fileURLToPath(
  new URL("../review/owner/process.js", import.meta.url),
);
const sameProcess = (a: ProcessIdentity, b: ProcessIdentity) =>
  a.pid === b.pid && a.started === b.started && a.group === b.group;

export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

export function ownerAlive(owner: NonNullable<Run["owner"]>) {
  if (!processAlive(owner.pid)) return false;
  if (!owner.started || Date.now() - owner.heartbeat < 10_000) return true;
  return processTable().some(
    (row) => row.pid === owner.pid && row.started === owner.started,
  );
}

export function captureOwner(
  previous: Run["owner"],
): NonNullable<Run["owner"]> {
  const rows = processTable();
  const self = rows.find((row) => row.pid === process.pid);
  if (!self)
    throw new StateError("owner-unverified", "Cannot identify this run owner.");
  const owned = new Set([process.pid]);
  if (self.group === self.pid)
    for (const row of rows) if (row.group === self.group) owned.add(row.pid);
  for (const old of previous?.processes ?? []) {
    if (rows.some((row) => sameProcess(row, old))) owned.add(old.pid);
  }
  for (;;) {
    const size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
    if (size === owned.size) break;
  }
  return {
    pid: process.pid,
    started: self.started,
    heartbeat: Date.now(),
    processes: rows
      .filter((row) => row.pid !== process.pid && owned.has(row.pid))
      .map(({ pid, started, group }) => ({ pid, started, group })),
  };
}

export function verifyOwner(run: Run) {
  const owner = run.owner;
  if (!owner) return false;
  const info = spawnSync(
    "/bin/ps",
    ["-ww", "-p", String(owner.pid), "-o", "lstart=,command="],
    {
      encoding: "utf8",
      timeout: 1000,
      env: { LC_ALL: "C" },
    },
  );
  const line = info.stdout?.trim() ?? "";
  const match = /^(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/.exec(line);
  return (
    info.status === 0 &&
    match !== null &&
    (!owner.started || match[1]?.replace(/\s+/g, " ") === owner.started) &&
    (match[2]?.startsWith(`${process.execPath} `) ?? false) &&
    (match[2]?.endsWith(` ${ownerPath} ${run.repository} ${run.id}`) ?? false)
  );
}

export function ownerRecoveryGuidance(run: Run) {
  return `Inspect .degreaser/runs/${run.id}/run.json and owner.lock against local PID/start/group identities with process-inspection permission. Use the same Node executable as the original owner. Do not signal reused PIDs or remove ambiguous locks. If ownership cannot be verified, preserve this run and start a new review only after confirming old work has stopped.`;
}

/** A terminal run whose owner lock was removed has no owner or workers left. */
export function ownerReleased(run: Run) {
  return (
    run.status !== "running" &&
    !existsSync(statePath(run.repository, "runs", run.id, "owner.lock"))
  );
}
/** Released owners record only workers still alive at release; any listed are verified. */
export const needsCleanup = (run: Run) =>
  !ownerReleased(run) || Boolean(run.owner?.processes?.length);

export function assertAvailable(run: Run, initial = false) {
  if (run.owner && !ownerReleased(run) && processAlive(run.owner.pid)) {
    if (!verifyOwner(run))
      throw new StateError(
        "owner-unverified",
        `Cannot verify the owner of ${run.id}; no process was signalled. ${ownerRecoveryGuidance(run)}`,
      );
    throw new StateError(
      "run-busy",
      `Run already has a live owner, regardless of heartbeat age. Use degreaser-axi wait ${run.id}.`,
    );
  }
  if (
    !initial &&
    !run.owner &&
    run.status === "running" &&
    Date.now() - run.createdAt < 10_000
  )
    throw new StateError(
      "run-busy",
      `Run admission is still in progress. Use degreaser-axi wait ${run.id}.`,
    );
}

/** No saved PID is signalling authority. Recheck birth identity and group. */
export async function cleanInterruptedOwner(run: Run) {
  const owner = run.owner;
  if (!owner) return;
  const rows = processTable();
  const recorded = owner.processes ?? [];
  const known = rows.filter((row) =>
    recorded.some((old) => sameProcess(row, old)),
  );
  if (
    recorded.some((old) =>
      rows.some((row) => row.pid === old.pid && !sameProcess(row, old)),
    )
  )
    throw new StateError(
      "owner-unverified",
      `A recorded child PID was reused for ${run.id}; no process was signalled. ${ownerRecoveryGuidance(run)}`,
    );
  const group = rows.filter((row) => row.group === owner.pid);
  if (group.length && !known.some((row) => row.group === owner.pid))
    throw new StateError(
      "owner-unverified",
      `Old worker group cannot be verified for ${run.id}; no process was signalled. ${ownerRecoveryGuidance(run)}`,
    );
  const owned = new Set([...known, ...group].map((row) => row.pid));
  for (;;) {
    const size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
    if (size === owned.size) break;
  }
  const targets = rows.filter((row) => owned.has(row.pid));
  const groups = new Set(
    targets
      .filter(
        (row) =>
          row.group === owner.pid ||
          targets.some(
            (leader) => leader.pid === row.group && leader.group === row.group,
          ),
      )
      .map((row) => row.group),
  );
  for (const group of groups) {
    const current = processTable();
    if (
      current.some((row) => row.pid === owner.pid) ||
      !current.some(
        (row) =>
          row.group === group &&
          targets.some((target) => sameProcess(row, target)),
      )
    )
      throw new StateError(
        "owner-unverified",
        `Old process group changed for ${run.id}; no replacement worker was started. ${ownerRecoveryGuidance(run)}`,
      );
    try {
      process.kill(-group, "SIGKILL");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw new StateError(
          "owner-unverified",
          `Cannot stop verified old workers for ${run.id}. Resume from a caller with local signal permission.`,
        );
    }
  }
  for (const target of targets) {
    if (groups.has(target.group)) continue;
    if (!processTable().some((row) => sameProcess(row, target))) continue;
    try {
      process.kill(target.pid, "SIGKILL");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw new StateError(
          "owner-unverified",
          `Cannot stop verified old workers for ${run.id}. Resume from a caller with local signal permission.`,
        );
    }
  }
  const end = Date.now() + 3000;
  for (;;) {
    const remaining = processTable().filter(
      (row) =>
        row.group === owner.pid ||
        targets.some((target) => sameProcess(row, target)),
    );
    if (!remaining.length) return;
    if (Date.now() >= end)
      throw new StateError(
        "run-busy",
        `Old workers have not exited. Use degreaser-axi resume ${run.id} after cleanup; no replacement worker was started.`,
      );
    await setTimeout(25);
  }
}
