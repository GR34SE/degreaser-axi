import type { Runtime } from "../../util/exec/types.ts";
import { git } from "../../util/git/exec.ts";
import type { ReviewInput } from "../types.ts";
import type { Finding } from "./types.ts";

export const SHARD_BYTES = 40_000;
export const VERIFY_BATCH = 20;

type PathRecord = ReviewInput["paths"][number];

export const readable = (p: PathRecord) =>
  !p.binary && p.oldMode !== "160000" && p.newMode !== "160000";

export function uncovered(input: ReviewInput, examined: readonly string[]) {
  const seen = new Set(examined);
  return input.paths
    .filter(readable)
    .filter((p) => !seen.has(p.path) && !(p.oldPath && seen.has(p.oldPath)))
    .map((p) => p.path);
}

export function pathSizes(runtime: Runtime, input: ReviewInput) {
  const sized = input.paths.flatMap((p) => {
    const oid = p.newOid ?? p.oldOid;
    return oid ? [{ path: p.path, oid }] : [];
  });
  const sizes = new Map<string, number>();
  if (!sized.length) return sizes;
  const out = git(
    runtime,
    input.repository,
    ["cat-file", "--batch-check=%(objectsize)"],
    {
      input: `${sized.map((s) => s.oid).join("\n")}\n`,
      allowFailure: () => true,
    },
  );
  const lines = out?.split("\n") ?? [];
  for (const [i, entry] of sized.entries()) {
    const size = Number(lines[i]);
    if (Number.isFinite(size)) sizes.set(entry.path, size);
  }
  return sizes;
}

export function packShards(
  paths: readonly string[],
  sizes: ReadonlyMap<string, number>,
  budgetBytes: number,
) {
  const shards: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = sizes.get(path) ?? budgetBytes;
    if (current.length && bytes + size > budgetBytes) {
      shards.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += size;
  }
  if (current.length) shards.push(current);
  return shards;
}

export function verifyBatches(findings: readonly Finding[], size: number) {
  const ordered = findings.toSorted(
    (a, b) =>
      (a.location.path < b.location.path
        ? -1
        : a.location.path > b.location.path
          ? 1
          : 0) || a.location.startLine - b.location.startLine,
  );
  return Array.from({ length: Math.ceil(ordered.length / size) }, (_, i) =>
    ordered.slice(i * size, (i + 1) * size),
  );
}
