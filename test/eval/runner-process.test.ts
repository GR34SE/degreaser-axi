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

test("real promptfoo runs file assertions, repeats without cache and journals scored records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-promptfoo-"));
  process.env.PROMPTFOO_CONFIG_DIR = join(directory, "state");
  const input = sample();
  let calls = 0;
  try {
    const report = await runEvaluation({
      samples: [input],
      outputDir: join(directory, "results"),
      model: "claude-haiku-4-5-20251001",
      repeat: 2,
      budget: 4,
      allowModels: true,
      provider: {
        id: () => "offline",
        callApi: async () => {
          calls++;
          return { output: JSON.stringify(envelope(input)) };
        },
      },
    });
    assert.equal(calls, 2);
    assert.equal(report.providerErrors, 0);
    assert.equal(report.assertionFailures, 0);
    const records = readFileSync(
      join(directory, "results/records.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(records.map((r) => r.repeat).sort(), [0, 1]);
    assert.ok(
      records.every((row) => row.metrics.recall === 1 && row.metrics.complete),
    );
    assert.equal(report.breakdown[0]?.recall, 1);
    assert.equal(report.breakdown[0]?.preserveRate, 1);
    const missed = envelope(input);
    missed.export.findings = [];
    const [coverage] = missed.export.coverage;
    assert.ok(coverage);
    coverage.status = "no-findings";
    const failedAssertions = await runEvaluation({
      samples: [input],
      outputDir: join(directory, "misses"),
      model: "claude-haiku-4-5-20251001",
      repeat: 1,
      budget: 2,
      allowModels: true,
      provider: {
        id: () => "offline-miss",
        callApi: async () => ({ output: JSON.stringify(missed) }),
      },
    });
    assert.equal(failedAssertions.assertionFailures, 1);
    assert.equal(failedAssertions.providerErrors, 0);
    assert.equal(failedAssertions.incompleteRecords, 0);
    assert.equal(failedAssertions.breakdown[0]?.recall, 0);
    const recovered = envelope(input);
    const partial = envelope(input);
    for (const row of recovered.export.coverage) row.rejected = 1;
    partial.export.status = "partial";
    for (const row of partial.export.coverage)
      Object.assign(row, { status: "incomplete", examined: "0/1" });
    for (const [name, output, incomplete] of [
      ["recovered", recovered, 0],
      ["partial", partial, 1],
    ] as const) {
      const report = await runEvaluation({
        samples: [input],
        outputDir: join(directory, name),
        model: "claude-haiku-4-5-20251001",
        repeat: 1,
        budget: 2,
        allowModels: true,
        provider: {
          id: () => `offline-${name}`,
          callApi: async () => ({ output: JSON.stringify(output) }),
        },
      });
      assert.equal(report.providerErrors, 0, name);
      assert.equal(report.incompleteRecords, incomplete, name);
      assert.equal(report.breakdown[0]?.completeness, 1 - incomplete, name);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("model execution and empty budgets fail before provider admission", async () => {
  let calls = 0;
  const provider = {
    id: () => "offline",
    callApi: async () => {
      calls++;
      return { output: "" };
    },
  };
  const options = {
    samples: [sample()],
    model: "claude-haiku-4-5-20251001",
    provider,
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
    runEvaluation({ ...options, allowModels: true, budget: 0 }),
    /positive integer/,
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
