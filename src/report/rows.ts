import { lines, type StoredFinding } from "./findings.ts";

const row = (f: StoredFinding) => ({
  id: f.id,
  aspect: f.aspect,
  lines: lines(f.location),
  action: f.action ?? "",
});

export const upheldRows = (all: readonly StoredFinding[]) =>
  Object.fromEntries(
    Object.entries(
      Object.groupBy(
        all.filter((f) => f.verdict === "upheld"),
        (f) => f.location.path,
      ),
    ).map(([path, group]) => [path, (group ?? []).map(row)]),
  );
