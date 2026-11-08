import { spawnSync } from "node:child_process";
import { StateError } from "../errors.ts";
import type { ProcessIdentity } from "./types.ts";

export interface ProcessRow extends ProcessIdentity {
  parent: number;
}

interface Budget {
  timeout: number;
  maxBuffer?: number;
}

/** Ownership checks run often and need only identities: keep them small and fast. */
const OWNERSHIP: Budget = { timeout: 1000 };

function readTable(args: string[], budget: Budget) {
  const result = spawnSync("/bin/ps", args, {
    encoding: "utf8",
    ...budget,
    env: { LC_ALL: "C" },
  });
  if (result.status !== 0)
    throw new StateError(
      "owner-unverified",
      "Cannot inspect local processes safely. Use a caller with process-inspection permission; no process was signalled.",
    );
  const unrecognized = () =>
    new StateError(
      "owner-unverified",
      "Unrecognized local process identity; no process was signalled.",
    );
  return {
    lines: result.stdout.trim().split("\n"),
    probe: result.pid,
    unrecognized,
  };
}

function identities(extra: string[], budget: Budget) {
  const columns = ["pid=", "ppid=", "pgid=", "lstart=", "stat=", ...extra];
  const { lines, probe, unrecognized } = readTable(
    ["-axo", columns.join(",")],
    budget,
  );
  return lines.flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 9 + extra.length) throw unrecognized();
    const row = {
      pid: Number(fields[0]),
      parent: Number(fields[1]),
      group: Number(fields[2]),
      started: fields.slice(3, 8).join(" "),
      extra: fields.slice(9),
    };
    // The probe itself is a child of the caller, never an owned process.
    return fields[8]?.startsWith("Z") || row.pid === probe ? [] : [row];
  });
}

/** Identities only: ownership never needs argv or CPU, which enlarge and slow `ps`. */
export function processTable(): ProcessRow[] {
  return identities([], OWNERSHIP).map(({ extra: _, ...row }) => row);
}

/** Identities with CPU use, for resource measurement under the caller's budget. */
export function processCpu(budget: Budget) {
  return identities(["%cpu="], budget).map(({ extra, ...row }) => ({
    ...row,
    cpu: Number(extra[0]),
  }));
}

/** Full command lines of live processes; callers keep them in memory only. */
export function processCommands(budget: Budget) {
  const { lines, probe, unrecognized } = readTable(
    ["-ww", "-axo", "pid=,stat=,command="],
    budget,
  );
  return lines.flatMap((line) => {
    const match = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) throw unrecognized();
    const pid = Number(match[1]);
    return match[2]?.startsWith("Z") || pid === probe
      ? []
      : [{ pid, command: match[3] ?? "" }];
  });
}
