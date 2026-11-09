import { readFileSync } from "node:fs";
import { stripLocalization, uniqueSnippetRange } from "./anchors.mjs";
import { safePath, sha256 } from "./io.mjs";

export const REFACTOR_TYPES = JSON.parse(
  readFileSync(new URL("./types.json", import.meta.url), "utf8"),
);
export const SWE_PATH =
  "extracted/swe-refactor-v1/SWE-Refactor/pure_refactoring_data.json";
export const SIMPLI_ROOT = "extracted/simplibench-dataset/remove_duplication";

export function deriveRefactoring(record, index) {
  // diffLocations interleaves old/new ranges without a side discriminator.
  // Locate the explicitly before-side method in the before-side whole file instead.
  const path = safePath(record.filePathBefore);
  if (!Object.hasOwn(REFACTOR_TYPES, record.type))
    return { reason: "unsupported-refactoring-type" };
  const aspects = REFACTOR_TYPES[record.type];
  if (record.isPureRefactoring !== true) return { reason: "not-declared-pure" };
  if (
    !/^[a-f0-9]{40}$/u.test(record.commitId ?? "") ||
    typeof record.projectName !== "string" ||
    !record.projectName.trim()
  ) {
    return { reason: "missing-pinned-source-identity" };
  }
  const range = uniqueSnippetRange(
    record.sourceCodeBeforeForWhole,
    record.sourceCodeBeforeRefactoring,
  );
  if (!range) return { reason: "missing-or-ambiguous-before-snippet" };
  return {
    id: `swe-refactor/${sha256(`${record.projectName}:${record.commitId}:${record.uniqueId ?? index}`).slice(0, 24)}`,
    family: "swe-refactor",
    cluster: `repository:${record.projectName.toLowerCase()}`,
    labelKind: "change-proxy",
    aspects,
    files: new Map([[path, Buffer.from(record.sourceCodeBeforeForWhole)]]),
    paths: [path],
    target: {
      report: [{ id: "before-method", path, lines: range, aspects }],
      preserve: [],
      forbidden: [],
    },
    provenance: {
      source: "swe-refactor-original",
      revision: record.commitId,
      recordIndex: index,
      project: record.projectName,
      refactoringType: record.type,
      localization: "unique-before-snippet; mixed-side diffLocations not used",
      context: "one original before-side whole file, not a full project",
    },
  };
}

export function deriveSimplification(tagged, raw, index) {
  if (!Number.isInteger(raw.idx) || tagged.idx !== raw.idx)
    return { reason: "tagged-untagged-identity-mismatch" };
  const ranges = stripLocalization(tagged.cs, raw.cs);
  if (!ranges) return { reason: "unverified-original-localization" };
  if (
    typeof tagged.java !== "string" ||
    typeof raw.java !== "string" ||
    tagged.java
      .replaceAll("<simplified>", "")
      .replaceAll("</simplified>", "") !== raw.java
  ) {
    return { reason: "tagged-untagged-after-mismatch" };
  }
  if (raw.cs === raw.java) return { reason: "unchanged-pair" };
  const path = "Before.java";
  return {
    id: `simplibench/${index}-${sha256(raw.cs).slice(0, 16)}`,
    family: "simplibench",
    // This export has no repository IDs: keep the entire source population together.
    cluster: "population:simplibench-small-test",
    labelKind: "change-proxy",
    aspects: [
      "unnecessary-complexity",
      "missed-reuse",
      "unnecessary-layers",
      "unidiomatic-code",
    ],
    files: new Map([[path, Buffer.from(raw.cs)]]),
    paths: [path],
    target: {
      report: ranges.map((lines, i) => ({
        id: `original-${i + 1}`,
        path,
        lines,
      })),
      preserve: [],
      forbidden: [],
    },
    provenance: {
      source: "simplibench-small-test",
      revision: `sha256:${sha256(JSON.stringify(raw))}`,
      recordIndex: index,
      sourceId: raw.idx,
      localization: "verified stripped original tags; raw physical lines",
      coarseLocalization: raw.cs.split("\n").length === 1,
      context:
        "original method fragment, not a full project; tags and after-side withheld",
    },
  };
}

export function loadPairs(reader, sources, accept, skip, counts) {
  if (sources.includes("swe-refactor")) {
    const records = reader.json(SWE_PATH);
    if (!Array.isArray(records))
      throw new Error("SWE-Refactor must be a JSON array");
    counts["swe-refactor"] = records.length;
    records.forEach((record, index) => {
      const result = deriveRefactoring(record, index);
      if (result.reason) skip("swe-refactor", index, result.reason);
      else accept(result);
    });
  }
  if (sources.includes("simplibench")) {
    const tagged = reader.jsonl(`${SIMPLI_ROOT}/tagged/json/small/test.jsonl`);
    const raw = reader.jsonl(`${SIMPLI_ROOT}/untagged/json/small/test.jsonl`);
    if (tagged.length !== raw.length)
      throw new Error("SimpliBench representation count mismatch");
    counts.simplibench = raw.length;
    raw.forEach((record, index) => {
      const result = deriveSimplification(tagged[index], record, index);
      if (result.reason) skip("simplibench", index, result.reason);
      else accept(result);
    });
  }
}
