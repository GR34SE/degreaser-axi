import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewInput } from "../types.ts";
import { applyVerdicts, emptyResult, mergeFinder, settle } from "./merge.ts";
import type { Candidate, FinderResult } from "./types.ts";

const input = {
  paths: ["a.ts", "b.ts", "c.png"].map((path) => ({
    path,
    oldPath: null,
    status: "audit",
    oldMode: null,
    newMode: "100644",
    oldOid: null,
    newOid: "0".repeat(40),
    binary: path.endsWith(".png"),
  })),
} as unknown as ReviewInput;

const at = (path: string, line = 1): Candidate => ({
  location: { path, side: "new", startLine: line, endLine: line },
  quote: "// note",
  title: "Narration",
});
const found = (
  status: FinderResult["status"],
  findings: Candidate[] = [],
  extra: Partial<FinderResult> = {},
): FinderResult => ({
  aspect: "low-value-comments",
  status,
  findings,
  limitations: [],
  ...extra,
});

test("a shard covers its paths only when its finder did not stop incomplete", () => {
  const result = emptyResult("low-value-comments");
  mergeFinder(
    result,
    found("incomplete", [at("a.ts")], { limitations: ["Ran out."] }),
    ["a.ts"],
    ["a.ts"],
    1,
  );
  assert.deepEqual(result.examinedPaths, []);
  assert.deepEqual(result.limitations, ["Shard 1 (1 path): Ran out."]);
  mergeFinder(result, found("no-findings"), ["b.ts"], ["b.ts"], 2);
  assert.equal(
    settle(input, result, ["incomplete", "no-findings"]),
    "incomplete",
  );
  assert.match(
    result.limitations.join(" "),
    /Unexamined assessed paths \(1\): a\.ts/,
  );
  const added = mergeFinder(
    result,
    found("findings", [at("a.ts"), at("a.ts", 2)]),
    ["a.ts"],
    ["a.ts"],
    3,
  );
  assert.equal(added.length, 1);
  assert.deepEqual(result.examinedPaths, ["b.ts", "a.ts"]);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((f) => f.verdict === "unverified"));
  assert.equal(settle(input, result, ["findings"]), "incomplete");
  assert.doesNotMatch(result.limitations.join(" "), /Unexamined/);
  assert.match(result.limitations.join(" "), /Unverified findings \(2\)/);
});

test("verdicts settle the aspect: upheld means findings, all refuted means no findings", () => {
  const result = emptyResult("low-value-comments");
  mergeFinder(
    result,
    found("findings", [at("a.ts"), at("a.ts", 2)]),
    ["a.ts", "b.ts"],
    ["a.ts", "b.ts"],
    1,
  );
  applyVerdicts(result.findings, [
    {
      candidate: 1,
      verdict: "refuted",
      reason: "Warns of a trap.",
      action: "ignored",
    },
  ]);
  assert.deepEqual(result.findings[0], {
    ...at("a.ts"),
    verdict: "refuted",
    reason: "Warns of a trap.",
  });
  assert.equal(settle(input, result, ["findings"]), "incomplete");
  applyVerdicts(result.findings.slice(1), [
    { candidate: 1, verdict: "refuted", reason: "Fine." },
  ]);
  assert.equal(settle(input, result, ["findings"]), "no-findings");
  assert.deepEqual(result.limitations, []);
  result.findings[1] = {
    ...at("a.ts", 2),
    verdict: "upheld",
    action: "Delete.",
  };
  assert.equal(settle(input, result, ["findings"]), "findings");
});

test("an aspect is not applicable only when every shard says so", () => {
  const result = emptyResult("low-value-comments");
  mergeFinder(
    result,
    found("not-applicable", [], { reason: "No comments." }),
    ["a.ts"],
    ["a.ts"],
    1,
  );
  mergeFinder(
    result,
    found("not-applicable", [], { reason: "No comments." }),
    ["b.ts"],
    ["b.ts"],
    2,
  );
  assert.equal(
    settle(input, result, ["not-applicable", "not-applicable"]),
    "not-applicable",
  );
  assert.equal(result.reason, "No comments.");
  assert.equal(
    settle(input, result, ["not-applicable", "no-findings"]),
    "no-findings",
  );
  assert.equal(result.reason, undefined);
  const empty = emptyResult("low-value-comments");
  assert.equal(settle({ ...input, paths: [] }, empty, []), "not-applicable");
  assert.match(empty.reason ?? "", /readable/);
});
