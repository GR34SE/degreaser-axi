import { spawnSync } from "node:child_process";
import { StateError } from "../errors.ts";
import type { ProcessIdentity } from "./types.ts";

export interface ProcessRow extends ProcessIdentity {
  parent: number;
}

/** Identities only: ownership never needs argv or CPU, which enlarge and slow `ps`. */
export function processTable(): ProcessRow[] {
  const result = spawnSync(
    "/bin/ps",
    ["-axo", "pid=,ppid=,pgid=,lstart=,stat="],
    { encoding: "utf8", timeout: 1000, env: { LC_ALL: "C" } },
  );
  if (result.status !== 0)
    throw new StateError(
      "owner-unverified",
      "Cannot inspect local processes safely. Use a caller with process-inspection permission; no process was signalled.",
    );
  return (
    result.stdout
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
      // The probe itself is a child of the caller, never an owned worker.
      .filter((row) => !row.zombie && row.pid !== result.pid)
  );
}
