import { randomBytes } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { StateError } from "../errors.ts";

export function atomicWrite(path: string, value: string) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    try {
      writeFileSync(temporary, value, { flag: "wx", mode: 0o600, flush: true });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  } catch {
    throw new StateError(
      "state-write-failed",
      `Could not atomically write state: ${path}`,
    );
  }
}
