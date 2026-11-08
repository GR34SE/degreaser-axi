import { spawnSync } from "node:child_process";
import { StateError } from "../errors.ts";
import type { ProcessIdentity } from "./types.ts";

export interface ProcessRow extends ProcessIdentity {
  parent: number;
  state: string;
  cpu: number;
  command: string;
}

/** Keep argv in memory only. Consumers emit owned PIDs, not unrelated commands. */
export function processTable(): ProcessRow[] {
  const result = spawnSync(
    "/bin/ps",
    ["-ww", "-axo", "pid=,ppid=,pgid=,lstart=,stat=,%cpu=,command="],
    { encoding: "utf8", timeout: 1000, env: { LC_ALL: "C" } },
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
      const fields =
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+([\d.]+)\s+(.+)$/.exec(
          line,
        );
      if (!fields?.[4] || !fields[5] || !fields[7])
        throw new StateError(
          "owner-unverified",
          "Unrecognized local process identity; no process was signalled.",
        );
      return {
        pid: Number(fields[1]),
        parent: Number(fields[2]),
        group: Number(fields[3]),
        started: fields[4].replace(/\s+/g, " "),
        state: fields[5],
        cpu: Number(fields[6]),
        command: fields[7],
      };
    })
    .filter((row) => !row.state.startsWith("Z") && row.pid !== result.pid);
}
