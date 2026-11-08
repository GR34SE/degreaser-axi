import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { StateError } from "../util/errors.ts";
import { captureOwner, ownerRecoveryGuidance } from "./ownership.ts";
import type { Run } from "./run.ts";
import { statePath } from "./store.ts";

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
        `Lock identity is ambiguous: ${path}; no process was signalled. ${ownerRecoveryGuidance(run)}`,
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
