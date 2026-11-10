import assert from "node:assert/strict";
import test from "node:test";
import { compareRuns } from "../../eval/gate.mjs";
import { first, oneSource } from "./gate-fixture.ts";

test("one source cluster with enough identical samples passes with sample resampling and single-source scope", () => {
  const baseline = oneSource(8);
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, "passed");
  assert.equal(result.pass, true);
  assert.equal(result.evidenceScope, "single-source");
  const family = first(result.families);
  assert.equal(family.evidenceScope, "single-source");
  assert.equal(family.metrics.recall?.unit, "sample");
  assert.equal(family.metrics.recall?.units, 8);
  assert.equal(family.metrics.recall?.clusters, 1);
  assert.ok(
    result.method.notes.some((note: string) =>
      note.includes("that source repository only"),
    ),
  );
});

test("one source cluster with seven samples stays inconclusive", () => {
  const baseline = oneSource(7);
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.equal(result.pass, false);
  assert.equal(result.status, "inconclusive");
  assert.equal(first(result.families).metrics.recall?.status, "inconclusive");
  assert.equal(first(result.families).evidenceScope, "multi-source");
});

test("a candidate clearly worse on recall across samples regresses", () => {
  const baseline = oneSource(10);
  const candidate = oneSource(10, () => false);
  const result = compareRuns(baseline, candidate);
  assert.equal(result.status, "regressed");
  assert.equal(result.pass, false);
  assert.equal(first(result.families).metrics.recall?.status, "regressed");
});

test("a candidate clearly better on recall improves in improvement mode", () => {
  const baseline = oneSource(10, () => false);
  const candidate = oneSource(10);
  const result = compareRuns(baseline, candidate, { mode: "improvement" });
  assert.equal(result.improved, true);
  assert.equal(result.pass, true);
  assert.equal(first(result.families).metrics.recall?.improved, true);
});

test("repeats do not increase the unit count", () => {
  const eight = oneSource(8, () => true, 3);
  const enough = compareRuns(eight, structuredClone(eight));
  assert.equal(first(enough.families).metrics.recall?.units, 8);
  assert.equal(enough.pass, true);
  const seven = oneSource(7, () => true, 3);
  const short = compareRuns(seven, structuredClone(seven));
  assert.equal(short.status, "inconclusive");
  assert.equal(first(short.families).metrics.recall?.units, 1);
});

test("a family without preserve labels passes and lists the unsupported metric", () => {
  const baseline = oneSource(8);
  for (const row of baseline) row.sample.target.preserve = [];
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.equal(result.pass, true);
  const family = first(result.families);
  assert.deepEqual(family.unsupportedMetrics, ["preserveRate"]);
  assert.equal(family.metrics.preserveRate?.status, "unsupported");
  assert.equal(family.pass, true);
});

test("a family without report anchors has no detection evidence and cannot pass", () => {
  const baseline = oneSource(8);
  for (const row of baseline) row.sample.target.report = [];
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.equal(result.pass, false);
  const family = first(result.families);
  assert.equal(family.metrics.recall?.status, "unsupported");
  assert.ok(family.unsupportedMetrics.includes("recall"));
  assert.equal(family.pass, false);
});

test("two source clusters keep cluster resampling", () => {
  const baseline = oneSource(
    8,
    () => true,
    1,
    (i) => `repo-${i % 2}`,
  );
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.equal(result.pass, true);
  const recall = first(result.families).metrics.recall;
  assert.equal(recall?.unit, "cluster");
  assert.equal(recall?.units, 2);
  assert.equal(result.evidenceScope, "multi-source");
});
