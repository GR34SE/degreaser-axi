import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runEvaluation } from "../../eval/runner.mjs";

function sample() {
  return {
    id: "offline",
    family: "synthetic",
    split: "dev",
    labelKind: "synthetic",
    aspects: ["low-value-comments"],
    repo: { directory: "/not-used-by-offline-provider" },
    review: { scope: "repository", task: "Audit comments.", paths: ["a.ts"] },
    provenance: { source: "synthetic", revision: "offline" },
    target: {
      report: [{ id: "R1", path: "a.ts", lines: [2, 2] }],
      preserve: [{ id: "P1", path: "a.ts", lines: [5, 5] }],
      forbidden: [],
    },
  };
}

function envelope(input: ReturnType<typeof sample>) {
  return {
    sampleId: input.id,
    export: {
      schemaVersion: 1,
      run: "offline",
      status: "completed",
      scope: "repository",
      task: input.review.task,
      base: null,
      tree: "tree",
      findings: [
        {
          id: "F1",
          group: "G1",
          aspect: "low-value-comments",
          path: "a.ts",
          side: "new",
          startLine: 2,
          endLine: 2,
          title: "Comment repeats code.",
          quote: "// Return the value",
          evidence: "a.ts:2",
          consequence: "No information beyond code.",
          countercheck: "Not a contract.",
          recommendation: "Remove the narration.",
        },
      ],
      coverageBasis: "worker-declared",
      coverage: [
        {
          aspect: "low-value-comments",
          status: "findings",
          rejected: 0,
          examined: "1/1",
          limitations: [],
        },
      ],
      limitations: [],
    },
    meta: {
      agent: "claude",
      model: "claude-haiku-4-5-20251001",
      productSha: "offline",
      sampleHash: "input",
      sessionCount: 1,
      durationMs: 1,
    },
  };
}

async function run(name: string, directory: string, outputs: unknown[]) {
  const input = sample();
  let calls = 0;
  const report = await runEvaluation({
    samples: [input],
    outputDir: join(directory, name),
    model: "claude-haiku-4-5-20251001",
    repeat: outputs.length,
    budget: 2 * outputs.length,
    concurrency: 2,
    allowModels: true,
    review: async () => {
      const output = outputs[calls++];
      if (output instanceof Error) throw output;
      return output;
    },
  });
  const records = readFileSync(join(directory, name, "records.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { report, records, calls };
}

test("each repeat is reviewed once and scored into records and summaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-runner-"));
  const input = sample();
  try {
    const missed = envelope(input);
    missed.export.findings = [];
    Object.assign(missed.export.coverage[0] ?? {}, { status: "no-findings" });
    const { report, records, calls } = await run("results", directory, [
      envelope(input),
      missed,
    ]);
    assert.equal(calls, 2);
    assert.deepEqual(
      records.map((row) => [row.repeat, row.metrics.recall]),
      [
        [0, 1],
        [1, 0],
      ],
    );
    assert.equal(report.providerErrors, 0);
    assert.equal(report.incompleteRecords, 0);
    assert.equal(report.breakdown[0]?.recall, 0.5);
    assert.equal(report.breakdown[0]?.preserveRate, 1);
    const summary = JSON.parse(
      readFileSync(join(directory, "results/summary.json"), "utf8"),
    );
    assert.deepEqual(summary, report);
    assert.ok(readFileSync(join(directory, "results/summary.md"), "utf8"));
    const manifest = JSON.parse(
      readFileSync(join(directory, "results/manifest.json"), "utf8"),
    );
    assert.equal(manifest.model, "claude-haiku-4-5-20251001");
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("partial reviews and provider failures never become clean records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-runner-"));
  const input = sample();
  const partial = envelope(input);
  partial.export.status = "partial";
  Object.assign(partial.meta, { outcome: "worker-quality-partial" });
  for (const row of partial.export.coverage)
    Object.assign(row, { status: "incomplete", examined: "0/1" });
  const unattributed = structuredClone(partial);
  delete (unattributed.meta as { outcome?: string }).outcome;
  try {
    const { report, records } = await run("mixed", directory, [
      partial,
      unattributed,
      new Error("Authentication required."),
    ]);
    assert.deepEqual(
      records.map((row) => row.metrics?.reason ?? row.error),
      ["incomplete-review", "unattributed-partial", "Authentication required."],
    );
    assert.ok(records.every((row) => !row.metrics?.complete));
    assert.equal(report.providerErrors, 1);
    assert.equal(report.incompleteRecords, 3);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("model execution and over-budget plans fail before any review", async () => {
  let calls = 0;
  const options = {
    samples: [sample()],
    model: "claude-haiku-4-5-20251001",
    review: async () => {
      calls++;
      return {};
    },
    outputDir: "/not-created-by-rejected-plan",
  };
  await assert.rejects(runEvaluation(options), /allow-models/);
  for (const model of [
    "claude-haiku-4-5",
    "claude-haiku-latest",
    "claude-haiku-4-5-20251001-preview",
  ])
    await assert.rejects(
      runEvaluation({ ...options, model, allowModels: true }),
      /claude-haiku-4-5-20251001/,
    );
  await assert.rejects(
    runEvaluation({ ...options, allowModels: true, budget: 5 }),
    /exceed budget/,
  );
  await assert.rejects(
    runEvaluation({
      ...options,
      allowModels: true,
      samples: [
        {
          ...sample(),
          target: { report: [{ id: "broken" }], preserve: [], forbidden: [] },
        },
      ],
    }),
    /Invalid sample contract/,
  );
  assert.equal(calls, 0);
});
