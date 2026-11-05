// Synthetic filesystem faults at the real writer/prompt boundary. Never shipped.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const read = fs.readFileSync;
const open = fs.openSync;
const rename = fs.renameSync;
const planPath = process.env.SYNTHETIC_STORAGE_FAULT;
let admitted = false;
function plan() {
  return planPath && fs.existsSync(planPath)
    ? JSON.parse(read(planPath, "utf8"))
    : {};
}
function pause(fault) {
  const end = Date.now() + 15000;
  while (!fs.existsSync(fault.release)) {
    if (Date.now() >= end) throw new Error("Writer barrier watchdog");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
fs.openSync = (path, ...args) => {
  const fault = plan();
  if (
    fault.mode === "before-admission" &&
    process.argv[1]?.endsWith("/run-owner.js") &&
    String(path).endsWith("/run.json")
  ) {
    fs.writeFileSync(fault.marker, "");
    pause(fault);
  }
  return open(path, ...args);
};
fs.readFileSync = (path, ...args) => {
  const fault = plan();
  const name = path instanceof URL ? fileURLToPath(path) : String(path);
  const value = read(path, ...args);
  if (name.includes("/aspects/a06-") && (!fault.afterAdmission || admitted)) {
    if (fault.mode === "prompt-mismatch") return `${value}\nChanged rubric.`;
    if (fault.mode === "prompt-error")
      throw new Error("Synthetic unexpected task error with SECRET-canary");
  }
  return value;
};
fs.renameSync = (source, destination) => {
  const fault = plan();
  const run = String(destination).endsWith("/run.json")
    ? JSON.parse(read(source, "utf8"))
    : null;
  if (
    run &&
    fault.marker &&
    (fault.mode !== "resume-admission" ||
      (run.executions?.length === 2 &&
        JSON.parse(read(destination, "utf8")).status !== "running"))
  ) {
    fs.writeFileSync(
      fault.marker,
      JSON.stringify({
        source,
        destination,
        previous: read(destination, "utf8"),
        proposed: read(source, "utf8"),
      }),
    );
    if (fault.mode === "write-failure") {
      // Fail once: the owner must not retry a later mutation over the last commit.
      fs.unlinkSync(planPath);
      throw Object.assign(new Error("Synthetic disk failure SECRET-canary"), {
        code: "EIO",
      });
    }
    if (fault.mode === "pause" || fault.mode === "resume-admission") {
      pause(fault);
    }
  }
  const result = rename(source, destination);
  if (run?.owner?.pid === process.pid) admitted = true;
  return result;
};
syncBuiltinESMExports();
