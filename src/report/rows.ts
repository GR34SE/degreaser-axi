import { lines, type StoredFinding } from "./findings.ts";

const byPath = (
  all: readonly StoredFinding[],
  verdict: StoredFinding["verdict"],
  detail: (f: StoredFinding) => Record<string, string>,
) =>
  Object.fromEntries(
    Object.entries(
      Object.groupBy(
        all.filter((f) => f.verdict === verdict),
        (f) => f.location.path,
      ),
    ).map(([path, group]) => [
      path,
      (group ?? []).map((f) => ({
        id: f.id,
        aspect: f.aspect,
        lines: lines(f.location),
        ...detail(f),
      })),
    ]),
  );

export const upheldRows = (all: readonly StoredFinding[]) =>
  byPath(all, "upheld", (f) => ({ action: f.action ?? "" }));

export const unverifiedRows = (all: readonly StoredFinding[]) =>
  byPath(all, "unverified", (f) => (f.reason ? { reason: f.reason } : {}));
