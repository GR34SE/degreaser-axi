import type { Runtime } from "../../util/exec/types.ts";
import { git } from "../../util/git/exec.ts";
import type { ReviewInput } from "../types.ts";
import type { Unresolved, WorkerResult } from "./types.ts";

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

// Whole-repository assignments previously exhausted worker turns before covering all paths.
export function portionBounds(maxTurns: number) {
  const paths = Math.max(1, Math.floor(maxTurns / 2));
  return { paths, bytes: paths * 32 * 1024 };
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

export function takePortion(
  paths: readonly string[],
  sizes: ReadonlyMap<string, number>,
  maxPaths: number,
  maxBytes: number,
) {
  const portion: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = sizes.get(path) ?? maxBytes;
    if (portion.length >= maxPaths) break;
    if (portion.length && bytes + size > maxBytes) break;
    portion.push(path);
    bytes += size;
  }
  return portion;
}

export const nextLimit = (portionSize: number) =>
  portionSize <= 1 ? 0 : Math.floor(portionSize / 2);

const UNEXAMINED = "Unexamined assessed paths (";

export function mergePass(
  input: ReviewInput,
  prior: WorkerResult | null,
  pass: WorkerResult,
  earlierApplicable = false,
  resolving = false,
  portion?: { index: number; paths: number },
): WorkerResult {
  const label = portion
    ? `Portion ${portion.index} (${portion.paths} path${portion.paths === 1 ? "" : "s"}): `
    : "";
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
  const seen = new Set<string>();
  const findings = [...(prior?.findings ?? []), ...pass.findings].filter(
    (f) => !seen.has(JSON.stringify(f)) && Boolean(seen.add(JSON.stringify(f))),
  );
  const taskScoped =
    pass.aspect === "scope-creep" &&
    pass.status === "not-applicable" &&
    !earlierApplicable;
  const missing = taskScoped ? [] : uncovered(input, examined);
  const assessed = new Set(input.paths.map((p) => p.path));
  let outside = 0;
  const named = (items: Unresolved[]) =>
    items.map((u) => {
      if (!u.paths) return u;
      const mapped = [...new Set(u.paths.map((p) => renamed.get(p) ?? p))];
      const inside = mapped.filter((p) => assessed.has(p));
      outside += mapped.length - inside.length;
      return { ...u, paths: inside };
    });
  const answered = resolving && pass.status !== "incomplete";
  const carried = answered
    ? []
    : resolving && pass.unresolved?.length
      ? []
      : (prior?.unresolved ?? []).filter(
          (u) =>
            !(
              u.scope === "paths" &&
              u.paths?.length &&
              u.paths.every((path) =>
                examined.includes(renamed.get(path) ?? path),
              )
            ),
        );
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
  const passReason = pass.reason && `${label}${pass.reason}`;
  const reason =
    prior?.reason &&
    passReason &&
    prior.reason !== pass.reason &&
    !prior.reason.includes(`): ${pass.reason}`)
      ? `${prior.reason} ${passReason}`
      : (prior?.reason ?? passReason);
  if (reason && ["not-applicable", "incomplete"].includes(merged.status))
    merged.reason = reason;
  if (merged.status === "incomplete" && !missing.length && !open.size)
    open.set("unspecified", {
      scope: "unspecified",
      reason:
        "Reported incomplete without naming what remains unresolved; see limitations.",
    });
  if (open.size) merged.unresolved = [...open.values()];
  const passLimitations = [
    ...(outside
      ? [
          `Ignored ${outside} unresolved path(s) named outside the assessed set.`,
        ]
      : []),
    ...pass.limitations,
  ];
  const kept = (prior?.limitations ?? []).filter(
    (l) => !l.startsWith(UNEXAMINED),
  );
  if (missing.length) {
    const shown = missing.slice(0, 20).join(", ");
    const more = missing.length > 20 ? ` and ${missing.length - 20} more` : "";
    merged.limitations.push(
      `${UNEXAMINED}${missing.length}): ${shown}${more}.`,
    );
  }
  merged.limitations = [
    ...new Set([
      ...merged.limitations,
      ...kept,
      ...passLimitations.map((l) => `${label}${l}`),
    ]),
  ];
  return merged;
}

export function progressed(prior: WorkerResult | null, next: WorkerResult) {
  return (
    (next.examinedPaths?.length ?? 0) > (prior?.examinedPaths?.length ?? 0)
  );
}
