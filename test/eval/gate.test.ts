import assert from "node:assert/strict";
import test from "node:test";
import { gate } from "./support/gate.ts";
import type { ReviewRecord } from "./support/review.ts";

const RECALLS = [0.2, 0.4, 0.5, 0.6, 0.3, 0.7, 0.5, 0.4, 0.6, 0.5];
const identity = (sample: number, repeat: number) => ({
  sample: `s${sample}`,
  repeat,
  input: `input-${sample}`,
  model: "claude-haiku-4-5-20251001",
});
const run = (delta: number, samples = RECALLS.length): ReviewRecord[] =>
  RECALLS.slice(0, samples).flatMap((recall, sample) =>
    [0, 1].map((repeat) => ({
      ...identity(sample, repeat),
      outcome: "complete",
      recall: recall + delta,
      recallPrimary: recall + delta,
      retention: 1,
      hits: [],
      preserveHits: [],
    })),
  );
const baseline = run(0);

test("an unchanged candidate passes non-regression but not improvement", () => {
  const result = gate(baseline, run(0), "non-regression");
  assert.equal(result.status, "passed");
  assert.equal(result.pairs, 20);
  assert.equal(result.metrics.recall.samples, 10);
  assert.deepEqual(result.metrics.recall.interval95, [0, 0]);
  const improvement = gate(baseline, run(0), "improvement");
  assert.equal(improvement.status, "not-improved");
  assert.equal(improvement.pass, false);
});

test("a measurable recall gain passes improvement and a loss regresses", () => {
  const gain = gate(baseline, run(0.2), "improvement");
  assert.equal(gain.status, "passed");
  assert.equal(gain.pass, true);
  const loss = gate(baseline, run(-0.2), "non-regression");
  assert.equal(loss.status, "regressed");
  assert.equal(loss.pass, false);
});

test("fewer than eight samples or an incomplete review leave recall inconclusive", () => {
  const few = gate(run(0, 7), run(0.2, 7), "improvement");
  assert.equal(few.metrics.recall.samples, 7);
  assert.equal(few.status, "inconclusive");
  const candidate = run(0.2);
  candidate[0] = { ...identity(0, 0), outcome: "incomplete" };
  const partial = gate(baseline, candidate, "improvement");
  assert.equal(partial.metrics.recall.status, "inconclusive");
  assert.equal(partial.metrics.completeness.candidate, 0.95);
  assert.equal(partial.pass, false);
});

test("errors, unpaired records and changed inputs never pass", () => {
  const failed: ReviewRecord = {
    ...identity(0, 0),
    outcome: "error",
    error: "Authentication required.",
  };
  for (const candidate of [
    [failed, ...run(0.2).slice(1)],
    run(0.2).slice(1),
    run(0.2).map((record) => ({ ...record, input: "changed" })),
  ]) {
    const result = gate(baseline, candidate, "non-regression");
    assert.equal(result.status, "invalid");
    assert.equal(result.pass, false);
    assert.ok(result.issues.length);
  }
});
