import { spawnSync } from "node:child_process";
import { readlinkSync, realpathSync } from "node:fs";
import { sep } from "node:path";

function processCwd(pid: number): string | undefined {
  if (process.platform === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return undefined;
    }
  }
  const out = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  return out.stdout
    ?.split("\n")
    .find((entry) => entry.startsWith("n"))
    ?.slice(1);
}

/** Stop only Cursor processes whose working directory is inside the disposable repo. */
export function stopCursorAt(directory: string) {
  const root = realpathSync(directory);
  const listed = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
  });
  for (const line of listed.stdout.split("\n")) {
    if (!line.includes("cursor-agent") && !line.includes("index.js")) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!pid || pid === process.pid) continue;
    const cwd = processCwd(pid);
    if (cwd !== root && !cwd?.startsWith(root + sep)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process exited between listing and the signal.
    }
  }
}
