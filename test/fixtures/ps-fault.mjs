// Synthetic process-inspection fault for the run owner only. Never shipped.
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, ...args) => {
  const marker = process.env.SYNTHETIC_PS_FAULT;
  if (
    command === "/bin/ps" &&
    marker &&
    process.argv[1]?.endsWith("/review/owner/process.js") &&
    fs.existsSync(marker)
  )
    return {
      status: null,
      error: new Error("Synthetic ps timeout"),
      stdout: "",
    };
  return spawnSync(command, ...args);
};
syncBuiltinESMExports();
