import assert from "node:assert/strict";
import test from "node:test";
import { compareRuns } from "../../eval/gate.mjs";
import { first, partial, records } from "./gate-fixture.ts";

test("a candidate that loses review completeness regresses instead of passing or vanishing", () => {
  const baseline = records();
  const candidate = structuredClone(baseline);
  candidate.forEach(partial);
  const result = compareRuns(baseline, candidate);
  assert.equal(result.pass, false);
  assert.equal(result.status, "regressed");
  assert.deepEqual(result.issues, []);
  const { completeness, recall } = first(result.families).metrics;
  assert.equal(completeness?.baseline, 1);
  assert.equal(completeness?.candidate, 0);
  assert.equal(completeness?.status, "regressed");
  assert.notEqual(recall?.status, "passed");
  assert.equal(recall?.excludedRows.length, 6);
  assert.ok(
    recall?.excludedRows.every(
      (row: { reason: string }) => row.reason === "incomplete-review",
    ),
  );
});

test("incomplete reviews on both sides keep completeness flat but cannot grant a pass", () => {
  const baseline = records();
  partial(first(baseline));
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.deepEqual(result.issues, []);
  assert.equal(result.pass, false);
  assert.equal(result.status, "inconclusive");
  const { completeness, recall } = first(result.families).metrics;
  assert.equal(completeness?.delta, 0);
  assert.equal(completeness?.status, "passed");
  assert.equal(recall?.status, "inconclusive");
  assert.equal(recall?.excludedRows[0]?.reason, "incomplete-review");
});

test("recovered rejected quotes in completed reviews remain valid paired evidence", () => {
  const baseline = records();
  const candidate = structuredClone(baseline);
  for (const row of candidate) first(row.envelope.export.coverage).rejected = 1;
  const result = compareRuns(baseline, candidate);
  assert.deepEqual(result.issues, []);
  assert.equal(result.pass, true);
});

test("records without a source cluster are invalid rather than independent", () => {
  const baseline = records();
  const candidate = structuredClone(baseline);
  for (const rows of [baseline, candidate])
    for (const row of rows) delete (row.sample as { cluster?: string }).cluster;
  const result = compareRuns(baseline, candidate);
  assert.equal(result.pass, false);
  assert.equal(result.status, "invalid");
  assert.ok(
    result.issues.some(
      (issue: { code: string }) => issue.code === "invalid-identity-or-metrics",
    ),
  );
});
