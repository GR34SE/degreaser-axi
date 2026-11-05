import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { atomicWrite, StateError } from "./storage.ts";

export function conflict(path: string): never {
  throw new StateError(
    "integration-conflict",
    `Integration conflict at ${path}. Preserve or move your edits, then rerun setup hooks with the same harnesses and scope. No selected integration was changed.`,
  );
}

export function readIntegrationFile(path: string): string | null {
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split("/")) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (
        stat.isSymbolicLink() ||
        (current !== path && !stat.isDirectory()) ||
        (current === path && !stat.isFile())
      )
        conflict(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  }
  return readFileSync(path, "utf8");
}

export class IntegrationEdits {
  private changes = new Map<
    string,
    { before: string | null; after: string | null }
  >();
  read(path: string): string | null {
    const change = this.changes.get(path);
    return change ? change.after : readIntegrationFile(path);
  }
  set(path: string, after: string | null) {
    const previous = this.changes.get(path);
    const before = previous ? previous.before : readIntegrationFile(path);
    this.changes.set(path, { before, after });
  }
  apply() {
    for (const [path, { before }] of this.changes)
      if (readIntegrationFile(path) !== before) conflict(path);
    const applied: string[] = [];
    try {
      for (const [path, { before, after }] of this.changes) {
        if (before === after) continue;
        if (readIntegrationFile(path) !== before) conflict(path);
        if (after === null) rmSync(path, { force: true });
        else {
          mkdirSync(dirname(path), { recursive: true });
          atomicWrite(path, after);
        }
        applied.push(path);
      }
    } catch (error) {
      // Restore only this invocation's writes, never a concurrent edit.
      for (const path of applied.reverse()) {
        const change = this.changes.get(path);
        if (!change || readIntegrationFile(path) !== change.after) continue;
        if (change.before === null) rmSync(path, { force: true });
        else atomicWrite(path, change.before);
      }
      if (error instanceof StateError && error.code === "integration-conflict")
        throw error;
      throw new StateError(
        "environment-blocked",
        "Integration write failed; completed writes were rolled back. Check directory permissions and rerun setup hooks.",
      );
    }
  }
}

export function parseObject(
  text: string,
  path: string,
): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* Report the path, never echo potentially sensitive configuration. */
  }
  return conflict(path);
}
