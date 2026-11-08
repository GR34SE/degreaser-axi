import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { sep } from "node:path";

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
    const cwdOut = spawnSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { encoding: "utf8" },
    );
    const cwd = cwdOut.stdout
      .split("\n")
      .find((entry) => entry.startsWith("n"))
      ?.slice(1);
    if (cwd !== root && !cwd?.startsWith(root + sep)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process exited between listing and the signal.
    }
  }
}
