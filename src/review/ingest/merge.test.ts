import assert from "node:assert/strict";
import test from "node:test";
import { applyVerdicts, emptyResult, mergeFinder, settle } from "./merge.ts";
import type { Candidate, FinderResult } from "./types.ts";

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
  examinedPaths: ["a.ts"],
  limitations: [],
  ...extra,
});

test("a rerun finder adds only new candidates and widens the declared examined paths", () => {
  const first = mergeFinder(
    emptyResult("low-value-comments"),
    found("incomplete", [at("a.ts")], { limitations: ["Ran out."] }),
  );
  const second = mergeFinder(
    first,
    found("findings", [at("a.ts"), at("b.ts")], { examinedPaths: ["b.ts"] }),
  );
  assert.deepEqual(second.examinedPaths, ["a.ts", "b.ts"]);
  assert.deepEqual(
    second.findings.map((f) => [f.location.path, f.verdict]),
    [
      ["a.ts", "unverified"],
      ["b.ts", "unverified"],
    ],
  );
  assert.equal(first.findings.length, 1);
});

test("only an unfinished finder makes the aspect incomplete; unverified candidates count as findings", () => {
  const result = mergeFinder(
    emptyResult("low-value-comments"),
    found("findings", [at("a.ts"), at("a.ts", 2)]),
  );
  assert.equal(settle(result, "incomplete").status, "incomplete");
  const open = settle(result, "findings");
  assert.equal(open.status, "findings");
  assert.match(open.limitations.join(" "), /Unverified findings \(2\)/);
  const refuted = applyVerdicts(result.findings, [
    { candidate: 1, verdict: "refuted", reason: "Warns.", action: "ignored" },
    { candidate: 2, verdict: "refuted", reason: "Fine." },
  ]);
  assert.deepEqual(refuted[0], {
    ...at("a.ts"),
    verdict: "refuted",
    reason: "Warns.",
  });
  assert.equal(result.findings[0]?.verdict, "unverified");
  const clean = settle({ ...result, findings: refuted }, "findings");
  assert.equal(clean.status, "no-findings");
  assert.deepEqual(clean.limitations, []);
});

test("an aspect is not applicable only when its finder says so and nothing was found", () => {
  const result = mergeFinder(
    emptyResult("low-value-comments"),
    found("not-applicable", [], { reason: "No comments." }),
  );
  const settled = settle(result, "not-applicable");
  assert.equal(settled.status, "not-applicable");
  assert.equal(settled.reason, "No comments.");
  const other = settle(result, "no-findings");
  assert.equal(other.status, "no-findings");
  assert.equal(other.reason, undefined);
  const empty = settle(emptyResult("low-value-comments"), "not-applicable");
  assert.match(empty.reason ?? "", /nothing this aspect is about/);
});
