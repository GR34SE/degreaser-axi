import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, parse } from "node:path";
import { atomicWrite, StateError } from "./storage.ts";

/** A conflict on a whole Degreaser file the user may choose to replace. */
export class IntegrationConflict extends StateError {
  readonly path: string;
  readonly replaceable: boolean;
  constructor(path: string, replaceable: boolean) {
    super(
      "integration-conflict",
      replaceable
        ? `Integration conflict at ${path}: it differs from this Degreaser version's file. If you did not edit it (an older Degreaser or a fresh clone installed it), delete it and rerun; otherwise preserve your edits first. No selected integration was changed.`
        : `Integration conflict at ${path}. Preserve or move your edits, then rerun setup hooks with the same harnesses and scope. No selected integration was changed.`,
    );
    this.path = path;
    this.replaceable = replaceable;
  }
}

export function conflict(path: string, replaceable = false): never {
  throw new IntegrationConflict(path, replaceable);
}

/** Target of a symlink at path, null when absent, "" for a directory. */
export function readIntegrationLink(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return readlinkSync(path);
    if (stat.isDirectory()) return "";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
  return conflict(path);
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

type Change = { before: string | null; after: string | null };

export class IntegrationEdits {
  private changes = new Map<string, Change>();
  private links = new Map<string, Change>();
  read(path: string): string | null {
    const change = this.changes.get(path);
    return change ? change.after : readIntegrationFile(path);
  }
  /** `known` supplies the before state of a file below a link being removed. */
  set(path: string, after: string | null, known?: { before: null }) {
    const previous = this.changes.get(path);
    const before = previous
      ? previous.before
      : known
        ? known.before
        : readIntegrationFile(path);
    this.changes.set(path, { before, after });
  }
  /** Symlink at path to target; null removes an existing link. */
  link(path: string, after: string | null) {
    this.links.set(path, { before: readIntegrationLink(path), after });
  }
  private underRemovedLink(path: string) {
    return [...this.links].some(
      ([link, { after }]) => after === null && path.startsWith(`${link}/`),
    );
  }
  /** Removes directories this removal emptied, never a stop directory or anything above it. */
  private prune(stops: readonly string[]) {
    const emptied = [
      ...[...this.changes].filter(
        ([, c]) => c.before !== c.after && c.after === null,
      ),
      ...[...this.links].filter(([, c]) => c.after === null),
    ].map(([path]) => dirname(path));
    for (let dir of emptied)
      while (
        !stops.includes(dir) &&
        stops.some((stop) => dir.startsWith(`${stop}/`))
      ) {
        try {
          if (readdirSync(dir).length) break;
          rmdirSync(dir);
        } catch {
          break;
        }
        dir = dirname(dir);
      }
  }
  apply(stops: readonly string[] = []) {
    for (const [path, { before }] of this.links)
      if (readIntegrationLink(path) !== before) conflict(path);
    for (const [path, { before }] of this.changes)
      if (!this.underRemovedLink(path) && readIntegrationFile(path) !== before)
        conflict(path);
    const applied: string[] = [];
    const linked: string[] = [];
    const setLink = (path: string, target: string | null) => {
      const current = readIntegrationLink(path);
      if (current === "") rmdirSync(path);
      else if (current !== null) rmSync(path);
      if (target === "") mkdirSync(path, { recursive: true });
      else if (target !== null) {
        mkdirSync(dirname(path), { recursive: true });
        symlinkSync(target, path);
      }
    };
    try {
      for (const [path, { after }] of this.links)
        if (after === null) {
          setLink(path, null);
          linked.push(path);
        }
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
      for (const [path, { after }] of this.links)
        if (after !== null) {
          setLink(path, after);
          linked.push(path);
        }
      this.prune(stops);
    } catch (error) {
      // Restore only this invocation's writes, never a concurrent edit.
      for (const path of linked.filter((p) => this.links.get(p)?.after))
        setLink(path, this.links.get(path)?.before ?? null);
      for (const path of applied.reverse()) {
        const change = this.changes.get(path);
        if (!change || readIntegrationFile(path) !== change.after) continue;
        if (change.before === null) rmSync(path, { force: true });
        else atomicWrite(path, change.before);
      }
      for (const path of linked.filter((p) => !this.links.get(p)?.after))
        setLink(path, this.links.get(path)?.before ?? null);
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
