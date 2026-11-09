import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { readSamples, planEvaluation, recordResult } = await import(
  "../../eval/runner.mjs"
);
const { analyzeRecords } = await import("../../eval/analysis.mjs");
const { default: journal } = await import("../../eval/journal.mjs");

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

test("promptfoo record conversion retains repeat identity and provider errors", () => {
  const result = {
    testCase: { vars: { sample: { id: "s" } } },
    repeatIndex: 2,
    response: { error: "quota unavailable" },
  };
  assert.deepEqual(recordResult(result), {
    sample: { id: "s" },
    repeat: 2,
    error: "quota unavailable",
  });
  const envelope = { sampleId: "s" };
  assert.deepEqual(
    recordResult({ ...result, response: { output: JSON.stringify(envelope) } })
      .envelope,
    envelope,
  );
  assert.match(
    recordResult({ ...result, response: { output: "not JSON" } }).error ?? "",
    /malformed JSON/,
  );
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

test("native recovery replaces the same repeat atomically, preserves peers and rejects changed input", () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-journal-"));
  const path = join(directory, "records.jsonl");
  const sample = { id: "one", review: { task: "original task" } };
  const context = (repeat: number, error: string) => ({
    test: { metadata: { journal: path } },
    result: {
      testCase: { vars: { sample } },
      repeatIndex: repeat,
      response: { error },
    },
  });
  try {
    journal("beforeEach", {});
    journal("afterEach", context(0, "interrupted"));
    journal("afterEach", context(1, "other repeat"));
    journal("afterEach", context(0, "retried"));
    const original = readFileSync(path, "utf8");
    const rows = original
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].error, "retried");
    assert.equal(rows[1].repeat, 1);
    const changed = context(0, "must not overwrite");
    changed.result.testCase.vars.sample = {
      id: "one",
      review: { task: "changed task" },
    };
    assert.throws(() => journal("afterEach", changed), /changed sample/);
    assert.equal(readFileSync(path, "utf8"), original);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
