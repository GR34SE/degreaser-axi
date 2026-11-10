import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { readSamples, planEvaluation } = await import("../../eval/runner.mjs");
const { analyzeRecords } = await import("../../eval/analysis.mjs");

test("evaluation budgets count workers per aspect and repeated execution", () => {
  const samples = [{ aspects: ["a", "b"] }, { aspects: ["c"] }];
  assert.equal(
    planEvaluation(samples, { repeat: 3, budget: 18 }).initialSessions,
    9,
  );
  assert.throws(
    () => planEvaluation(samples, { repeat: 3, budget: 17 }),
    /exceed/,
  );
  assert.equal(
    planEvaluation(samples, { repeat: 3, budget: 18 }).maximumSessions,
    18,
  );
  for (const repeat of [0, -1, 1.5, NaN])
    assert.throws(
      () => planEvaluation(samples, { repeat }),
      /positive integer/,
    );
});

test("manifest rejects duplicates and empty sources before launching workers", () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-manifest-"));
  try {
    const file = join(directory, "samples.jsonl");
    writeFileSync(file, "");
    assert.throws(() => readSamples(file), /empty/);
    const sample = { id: "s", aspects: ["a"], repo: { directory: "/source" } };
    writeFileSync(
      file,
      `${JSON.stringify(sample)}\n${JSON.stringify(sample)}\n`,
    );
    assert.throws(() => readSamples(file), /duplicate/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("analysis weights source samples, not repeats, and retains recurring misses", () => {
  const sample = { id: "one", family: "self", aspects: ["comments"] };
  const metrics = { recall: 0, complete: true, misses: ["R1"] };
  const rows = [
    { sample, repeat: 0, metrics },
    { sample, repeat: 1, metrics },
    {
      sample: { ...sample, id: "two" },
      repeat: 0,
      metrics: { recall: 1, complete: false, misses: [] },
    },
  ];
  const result = analyzeRecords(rows);
  assert.equal(result.breakdown[0]?.recall, 0.5);
  assert.equal(result.breakdown[0]?.completeness, 0.5);
  assert.deepEqual(result.systematicMisses, [
    { sampleId: "one", anchorId: "R1", missedRepeats: 2 },
  ]);
  const combined = analyzeRecords([
    {
      ...rows[0],
      sample: {
        ...sample,
        aspects: ["comments", "complexity"],
      },
    },
  ]);
  assert.equal(combined.breakdown.length, 1);
  assert.deepEqual(combined.breakdown[0]?.aspects, ["comments", "complexity"]);
});
