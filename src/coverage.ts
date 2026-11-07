import { git } from "./git.ts";
import type { ReviewInput } from "./input.ts";
import type { Unresolved, WorkerResult } from "./results.ts";

type PathRecord = ReviewInput["paths"][number];

/** Paths a worker can read as text; binary files and gitlinks carry no source evidence. */
export const readable = (p: PathRecord) =>
  !p.binary && p.oldMode !== "160000" && p.newMode !== "160000";

/** Readable assessed paths not yet named in `examined` (by new or old name). */
export function uncovered(input: ReviewInput, examined: readonly string[]) {
  const seen = new Set(examined);
  return input.paths
    .filter(readable)
    .filter((p) => !seen.has(p.path) && !(p.oldPath && seen.has(p.oldPath)))
    .map((p) => p.path);
}

/**
 * Largest portion one worker session is asked to judge, derived from its turn
 * budget instead of a fixed batch size. Roughly one turn reads a path and the
 * other half of the turns go to looking up connected code and to the answer, so
 * a portion holds at most maxTurns / 2 paths. One read returns about 2,000
 * lines; assuming 32 KiB per path on average caps the text a portion can ask
 * for. Observed audits that sent all 184 paths at once spent their turns on
 * repository-wide searches and covered 20-80 paths. These are starting bounds:
 * a pass without progress shrinks its portion (see nextLimit).
 */
export function portionBounds(maxTurns: number) {
  const paths = Math.max(1, Math.floor(maxTurns / 2));
  return { paths, bytes: paths * 32 * 1024 };
}

/** Blob size of each assessed path, from the resolved Git objects. */
export function pathSizes(input: ReviewInput) {
  const sized = input.paths.flatMap((p) => {
    const oid = p.newOid ?? p.oldOid;
    return oid ? [{ path: p.path, oid }] : [];
  });
  const sizes = new Map<string, number>();
  if (!sized.length) return sizes;
  const out = git(
    input.repository,
    ["cat-file", "--batch-check=%(objectsize)"],
    { input: `${sized.map((s) => s.oid).join("\n")}\n`, allowFailure: true },
  );
  const lines = out?.split("\n") ?? [];
  for (const [i, entry] of sized.entries()) {
    const size = Number(lines[i]);
    if (Number.isFinite(size)) sizes.set(entry.path, size);
  }
  return sizes;
}

/** First paths that fit both bounds; a portion always holds at least one path. */
export function takePortion(
  paths: readonly string[],
  sizes: ReadonlyMap<string, number>,
  maxPaths: number,
  maxBytes: number,
) {
  const portion: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = sizes.get(path) ?? 0;
    if (portion.length >= maxPaths) break;
    if (portion.length && bytes + size > maxBytes) break;
    portion.push(path);
    bytes += size;
  }
  return portion;
}

/**
 * Next portion size after a pass without progress: half of what just failed.
 * A single path that still makes no progress is unresolvable (returns 0).
 */
export const nextLimit = (portionSize: number) =>
  portionSize <= 1 ? 0 : Math.floor(portionSize / 2);

/**
 * Folds one focused pass into the aspect's accumulated result. Coverage only grows;
 * established findings are kept. Completion requires accumulated worker-declared
 * coverage; the coordinator does not independently observe file reads.
 */
export function mergePass(
  input: ReviewInput,
  prior: WorkerResult | null,
  pass: WorkerResult,
  earlierApplicable = false,
  resolving = false,
): WorkerResult {
  const current = new Set(input.paths.map((p) => p.path));
  const renamed = new Map(
    input.paths.flatMap((p) =>
      p.oldPath && !current.has(p.oldPath)
        ? [[p.oldPath, p.path] as const]
        : [],
    ),
  );
  const examined = [
    ...new Set(
      [...(prior?.examinedPaths ?? []), ...(pass.examinedPaths ?? [])].map(
        (path) => renamed.get(path) ?? path,
      ),
    ),
  ];
  // A worker may repeat a finding within one pass; keep one copy.
  const seen = new Set<string>();
  const findings = [...(prior?.findings ?? []), ...pass.findings].filter(
    (f) => !seen.has(JSON.stringify(f)) && Boolean(seen.add(JSON.stringify(f))),
  );
  // scope-creep's rubric decides applicability from the task's feature scope, not from files.
  const taskScoped =
    pass.aspect === "scope-creep" &&
    pass.status === "not-applicable" &&
    !earlierApplicable;
  const missing = taskScoped ? [] : uncovered(input, examined);
  // Open obligations stay until a pass that resolves them says otherwise. A
  // resolving pass replaces them only with a real answer; a pass that failed
  // before answering cannot erase them.
  const assessed = new Set(input.paths.map((p) => p.path));
  const named = (items: Unresolved[]) =>
    items.map((u) => ({
      ...u,
      ...(u.paths ? { paths: u.paths.filter((p) => assessed.has(p)) } : {}),
    }));
  const answered = resolving && pass.status !== "incomplete";
  const carried = answered
    ? []
    : resolving && pass.unresolved?.length
      ? []
      : (prior?.unresolved ?? []);
  const open = new Map(
    [...carried, ...named(pass.unresolved ?? [])].map(
      (u) => [JSON.stringify(u), u] as const,
    ),
  );
  const merged: WorkerResult = {
    aspect: pass.aspect,
    status:
      missing.length || pass.status === "incomplete" || open.size
        ? "incomplete"
        : findings.length
          ? "findings"
          : pass.status === "not-applicable" && !earlierApplicable
            ? "not-applicable"
            : "no-findings",
    findings,
    limitations: [],
    examinedPaths: examined,
  };
  // A not-applicable reason from one focused pass must not describe a whole
  // aspect that earlier passes found applicable.
  const reason = pass.reason ?? prior?.reason;
  if (reason && ["not-applicable", "incomplete"].includes(merged.status))
    merged.reason = reason;
  if (merged.status === "incomplete" && !missing.length && !open.size)
    open.set("unspecified", {
      scope: "unspecified",
      reason:
        "Reported incomplete without naming what remains unresolved; see limitations.",
    });
  if (open.size) merged.unresolved = [...open.values()];
  if (missing.length) {
    const shown = missing.slice(0, 20).join(", ");
    const more = missing.length > 20 ? ` and ${missing.length - 20} more` : "";
    merged.limitations.push(
      `Unexamined assessed paths (${missing.length}): ${shown}${more}.`,
    );
  }
  merged.limitations.push(...pass.limitations);
  return merged;
}

/**
 * True when the pass grew coverage. Findings alone are not progress: a pass can
 * restate earlier findings forever.
 */
export function progressed(prior: WorkerResult | null, next: WorkerResult) {
  return (
    (next.examinedPaths?.length ?? 0) > (prior?.examinedPaths?.length ?? 0)
  );
}
