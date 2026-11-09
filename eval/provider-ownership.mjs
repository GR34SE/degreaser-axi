import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function processes() {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart="], {
    encoding: "utf8",
    env: { LC_ALL: "C" },
    timeout: 1000,
    maxBuffer: 4_194_304,
  });
  if (result.status !== 0) {
    throw Object.assign(
      new Error("Cannot verify evaluation process ownership."),
      { cleanupFailed: true },
    );
  }
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            group: Number(match[3]),
            started: match[4],
          },
        ]
      : [];
  });
}
const same = (a, b) =>
  a.pid === b.pid && a.group === b.group && a.started === b.started;

export function descendants(pid) {
  const rows = processes(),
    owned = new Set([pid]);
  for (;;) {
    const size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
    if (size === owned.size)
      return rows.filter((row) => row.pid !== pid && owned.has(row.pid));
  }
}

// acpx/runtime has no public external-process cleanup helper. Before admission,
// no saved run exists for cancel; stop only descendants captured while our CLI lives.
export async function stopDiscovery(captured) {
  if (!captured.length) return;
  const until = Date.now() + 5000;
  for (;;) {
    const remaining = processes().filter((row) =>
      captured.some((old) => same(old, row)),
    );
    if (!remaining.length) return;
    for (const row of remaining) {
      try {
        process.kill(row.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (Date.now() >= until) {
      throw Object.assign(
        new Error("Evaluation discovery cleanup did not finish."),
        { cleanupFailed: true },
      );
    }
    await delay(25);
  }
}
