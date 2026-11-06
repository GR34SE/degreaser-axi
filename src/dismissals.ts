import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { requireGit } from "./git.ts";
import { atomicWrite, StateError, validDismissals } from "./storage.ts";

export interface Dismissal {
  aspect: string;
  path: string;
  title: string;
  quote: string;
  reason: string;
  dismissedAt: number;
}

/** Kept per Git repository, not per worktree, so decisions outlive worktrees. */
function dismissalsFile(repository: string) {
  const common = requireGit(repository, ["rev-parse", "--git-common-dir"]);
  return join(resolve(repository, common.trim()), "degreaser/dismissed.json");
}

function readDismissals(path: string): Dismissal[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (Array.isArray(value) && value.length === 0) return [];
  if (!validDismissals(value))
    throw new StateError(
      "state-corrupt",
      `${path} must be a JSON array of dismissed findings. Fix or delete it.`,
    );
  return value as Dismissal[];
}

const same = (a: Dismissal, b: Omit<Dismissal, "reason" | "dismissedAt">) =>
  a.aspect === b.aspect &&
  a.path === b.path &&
  a.title === b.title &&
  a.quote === b.quote;

export function recordDismissal(repository: string, entry: Dismissal) {
  const path = dismissalsFile(repository);
  const kept = readDismissals(path).filter((d) => !same(d, entry));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  atomicWrite(path, `${JSON.stringify([...kept, entry], null, 2)}\n`);
  return path;
}

const BUDGET = 16_384;

/** Newest dismissals for the assessed paths, bounded so prompts stay small. */
export function relevantDismissals(
  repository: string,
  paths: { path: string; oldPath: string | null }[],
): Dismissal[] {
  const assessed = new Set(paths.flatMap((p) => [p.path, p.oldPath]));
  const selected: Dismissal[] = [];
  let bytes = 0;
  for (const entry of readDismissals(dismissalsFile(repository))
    .filter((d) => assessed.has(d.path))
    .reverse()) {
    bytes += Buffer.byteLength(JSON.stringify(entry));
    if (bytes > BUDGET) break;
    selected.push(entry);
  }
  return selected;
}
