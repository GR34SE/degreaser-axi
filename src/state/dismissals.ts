import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { StateError } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { atomicWrite } from "../util/fs/atomic.ts";
import { requireGit } from "../util/git/exec.ts";
import { json } from "../util/json.ts";
import type { Dismissal } from "./dismissal.ts";
import { validDismissals } from "./schema.ts";

function dismissalsFile(runtime: Runtime, repository: string) {
  const common = requireGit(runtime, repository, [
    "rev-parse",
    "--git-common-dir",
  ]);
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

export function recordDismissal(
  runtime: Runtime,
  repository: string,
  entry: Dismissal,
) {
  const path = dismissalsFile(runtime, repository);
  const kept = readDismissals(path).filter((d) => !same(d, entry));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  atomicWrite(path, json([...kept, entry]));
  return path;
}

const BUDGET = 16_384;

export function relevantDismissals(
  runtime: Runtime,
  repository: string,
  paths: { path: string; oldPath: string | null }[],
): Dismissal[] {
  const assessed = new Set(paths.flatMap((p) => [p.path, p.oldPath]));
  const selected: Dismissal[] = [];
  let bytes = 0;
  for (const entry of readDismissals(dismissalsFile(runtime, repository))
    .filter((d) => assessed.has(d.path))
    .reverse()) {
    bytes += Buffer.byteLength(JSON.stringify(entry));
    if (bytes > BUDGET) break;
    selected.push(entry);
  }
  return selected;
}
