import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  type ProcessIdentity,
  type Run,
  StateError,
  statePath,
} from "./storage.ts";

export const ownerPath = fileURLToPath(
  new URL("../bin/run-owner.js", import.meta.url),
);
interface ProcessRow extends ProcessIdentity {
  parent: number;
}

function processTable(): ProcessRow[] {
  const result = spawnSync(
    "/bin/ps",
    ["-axo", "pid=,ppid=,pgid=,lstart=,stat="],
    {
      encoding: "utf8",
      timeout: 1000,
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  if (result.status !== 0)
    throw new StateError(
      "owner-unverified",
      "Cannot inspect local processes safely. Use a caller with process-inspection permission; no process was signalled.",
    );
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 9)
        throw new StateError(
          "owner-unverified",
          "Unrecognized local process identity; no process was signalled.",
        );
      return {
        pid: Number(fields[0]),
        parent: Number(fields[1]),
        group: Number(fields[2]),
        started: fields.slice(3, 8).join(" "),
        zombie: fields[8]?.startsWith("Z"),
      };
    })
    .filter((row) => !row.zombie);
}
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
      env: { ...process.env, LC_ALL: "C" },
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

export function assertAvailable(run: Run, initial = false) {
  if (run.owner && processAlive(run.owner.pid)) {
    if (!verifyOwner(run))
      throw new StateError(
        "owner-unverified",
        `Cannot verify the owner of ${run.id}; no process was signalled. Use degreaser-axi wait ${run.id} and inspect local ownership before recovery.`,
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
      `A recorded child PID was reused for ${run.id}; no process was signalled. Inspect ownership before resuming.`,
    );
  const group = rows.filter((row) => row.group === owner.pid);
  if (group.length && !known.some((row) => row.group === owner.pid))
    throw new StateError(
      "owner-unverified",
      `Old worker group cannot be verified for ${run.id}; no process was signalled. Wait for old workers to exit before resuming.`,
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
        `Old process group changed for ${run.id}; no replacement worker was started.`,
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

export function admissionLock(run: Run) {
  const path = statePath(run.repository, "runs", run.id, "admission.lock");
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new StateError(
        "run-busy",
        `Ownership admission is locked: ${path}. Use degreaser-axi wait ${run.id}. If admission died, verify all owners and workers have exited before removing only this admission lock.`,
      );
    throw new StateError(
      "state-write-failed",
      `Cannot acquire ownership: ${path}`,
    );
  }
  return () => {
    closeSync(fd);
    rmSync(path);
  };
}

export function checkOwnerLock(run: Run) {
  const path = statePath(run.repository, "runs", run.id, "owner.lock");
  if (existsSync(path)) {
    let previous: unknown;
    try {
      previous = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    if (
      !run.owner ||
      !previous ||
      typeof previous !== "object" ||
      !("pid" in previous) ||
      previous.pid !== run.owner.pid ||
      !("started" in previous) ||
      previous.started !== run.owner.started
    )
      throw new StateError(
        "owner-unverified",
        `Lock identity is ambiguous: ${path}. Verify the old owner and workers before recovery; no process was signalled.`,
      );
  }
}

export function replaceOwnerLock(run: Run) {
  const path = statePath(run.repository, "runs", run.id, "owner.lock");
  checkOwnerLock(run);
  const owner = captureOwner(null);
  try {
    rmSync(path, { force: true });
    writeFileSync(
      path,
      JSON.stringify({ pid: owner.pid, started: owner.started }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    throw new StateError(
      "state-write-failed",
      `Cannot write ownership lock: ${path}`,
    );
  }
  return { owner, release: () => rmSync(path) };
}
