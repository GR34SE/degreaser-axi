import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { compareRuns } from "../../eval/gate.mjs";
import { first, partial, type Row, record, records } from "./gate-fixture.ts";

test("unchanged paired samples pass non-regression without claiming improvement", () => {
  const baseline = records(8, (i) => i % 2 === 0);
  const candidate = structuredClone(baseline);
  for (const row of candidate) row.sample.repo.directory = "/different/machine";
  const result = compareRuns(baseline, candidate);
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, "passed");
  assert.equal(result.improved, false);
  assert.equal(result.metrics.recall.baseline, 0.5);
  assert.deepEqual(result.metrics.recall.interval95, [0, 0]);
  assert.equal(result.metrics.recall.samples, 8);
  const improvement = compareRuns(baseline, candidate, { mode: "improvement" });
  assert.equal(improvement.pass, false);
  assert.equal(improvement.status, "not-improved");
});

test("fewer than eight paired samples stay inconclusive, however many repeats", () => {
  for (const baseline of [
    records(7),
    records(1, () => true, 20),
    records(7, () => true, 3),
  ]) {
    const result = compareRuns(baseline, structuredClone(baseline));
    assert.equal(result.pass, false);
    assert.equal(result.status, "inconclusive");
    assert.equal(result.metrics.recall.status, "inconclusive");
    assert.equal(result.metrics.recall.interval95, null);
  }
  const eight = records(8, () => true, 3);
  const enough = compareRuns(eight, structuredClone(eight));
  assert.equal(enough.metrics.recall.samples, 8);
  assert.equal(enough.pass, true);
});

test("a candidate clearly worse on recall regresses; clearly better improves", () => {
  const regressed = compareRuns(
    records(10),
    records(10, () => false),
  );
  assert.equal(regressed.status, "regressed");
  assert.equal(regressed.metrics.recall.status, "regressed");
  const improved = compareRuns(
    records(10, () => false),
    records(10),
    {
      mode: "improvement",
    },
  );
  assert.equal(improved.pass, true);
  assert.equal(improved.improved, true);
  assert.equal(improved.metrics.recall.improved, true);
});

test("paired uncertainty, not the point difference, controls acceptance", () => {
  const baseline = records(8, (i) => i % 2 === 0);
  const candidate = records(8, (i) => (i < 2 ? i % 2 === 1 : i % 2 === 0));
  const result = compareRuns(baseline, candidate);
  assert.equal(result.metrics.recall.delta, 0);
  assert.equal(result.metrics.recall.status, "inconclusive");
  assert.equal(result.pass, false);
});

test("refuses mismatched manifests, identities, missing and duplicate pairs", () => {
  const baseline = records();
  const mutations: ((rows: Row[]) => void)[] = [
    (rows) => rows.pop(),
    (rows) => rows.push(structuredClone(first(rows))),
    (rows) => {
      first(rows).envelope.meta.sampleHash = "other";
    },
    (rows) => {
      first(first(rows).sample.target.report).lines = [4, 4];
    },
    (rows) => {
      first(rows).envelope.meta.model = "other";
    },
    (rows) => {
      first(rows).envelope.meta.agent = "other";
    },
    (rows) => {
      first(rows).repeat = 2;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    const result = compareRuns(baseline, candidate);
    assert.equal(result.pass, false);
    assert.equal(result.status, "invalid");
    assert.ok(result.issues.length > 0);
  }
});

test("empty runs, provider errors and unknown modes are invalid, never dropped", () => {
  assert.equal(compareRuns([], []).status, "invalid");
  assert.equal(compareRuns([{}], [{}]).status, "invalid");
  const baseline = records();
  const candidate = structuredClone(baseline);
  Object.assign(first(candidate), { error: "quota exhausted" });
  const result = compareRuns(baseline, candidate);
  assert.equal(result.status, "invalid");
  assert.ok(
    result.issues.some(
      (issue: { code: string }) => issue.code === "provider-error",
    ),
  );
  assert.equal(
    compareRuns(baseline, baseline, { mode: "best" }).status,
    "invalid",
  );
});

test("preserve without labels is unsupported and does not block; recall without labels cannot pass", () => {
  const unlabelled = records();
  for (const row of unlabelled) row.sample.target.preserve = [];
  const preserve = compareRuns(unlabelled, structuredClone(unlabelled));
  assert.equal(preserve.pass, true);
  assert.equal(preserve.metrics.preserveRate.status, "unsupported");
  for (const row of unlabelled) row.sample.target.report = [];
  const recall = compareRuns(unlabelled, structuredClone(unlabelled));
  assert.equal(recall.pass, false);
  assert.equal(recall.metrics.recall.status, "unsupported");
});

test("applies the recall and preserve three-point margins", () => {
  const baseline = records();
  for (const row of baseline) {
    const finding = first(row.envelope.export.findings);
    row.sample.target.report = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      path: "a.ts",
      lines: [i + 1, i + 1],
    }));
    row.sample.target.preserve = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      path: "a.ts",
      lines: [i + 1000, i + 1000],
    }));
    row.envelope.export.findings = row.sample.target.report.map((_, i) => ({
      ...finding,
      id: `F${i + 1}`,
      startLine: i + 1,
      endLine: i + 1,
    }));
  }
  for (const lost of [3, 4]) {
    const candidate = structuredClone(baseline);
    for (const row of candidate)
      for (const finding of row.envelope.export.findings.slice(0, lost)) {
        finding.startLine += 10000;
        finding.endLine += 10000;
      }
    const result = compareRuns(baseline, candidate);
    assert.equal(result.status, lost === 3 ? "passed" : "regressed");
  }
  for (const touched of [3, 4]) {
    const candidate = structuredClone(baseline);
    for (const row of candidate)
      first(row.envelope.export.findings).evidence = Array.from(
        { length: touched },
        (_, i) => `a.ts:${i + 1000}`,
      ).join(" ");
    const result = compareRuns(baseline, candidate);
    assert.equal(
      result.metrics.preserveRate.status,
      touched === 3 ? "passed" : "regressed",
    );
  }
});

test("a candidate that loses completeness regresses instead of vanishing", () => {
  const baseline = records();
  const candidate = structuredClone(baseline);
  candidate.forEach(partial);
  const result = compareRuns(baseline, candidate);
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, "regressed");
  assert.equal(result.metrics.completeness.candidate, 0);
  assert.equal(result.metrics.recall.status, "inconclusive");
});

test("one incomplete review on both sides cannot grant a pass", () => {
  const baseline = records();
  partial(first(baseline));
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.deepEqual(result.issues, []);
  assert.equal(result.status, "inconclusive");
  assert.equal(result.metrics.completeness.status, "passed");
  assert.equal(result.metrics.recall.status, "inconclusive");
});

test("an unattributed partial is invalid; recovered rejected quotes are complete", () => {
  const baseline = records();
  const unattributed = structuredClone(baseline);
  for (const row of unattributed) {
    partial(row);
    delete (row.envelope.meta as { outcome?: string }).outcome;
  }
  assert.equal(compareRuns(baseline, unattributed).status, "invalid");
  const recovered = structuredClone(baseline);
  for (const row of recovered) first(row.envelope.export.coverage).rejected = 1;
  assert.equal(compareRuns(baseline, recovered).status, "passed");
});

test("gate CLI writes a portable artifact without machine paths or quotes and exits by verdict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-gate-"));
  const run = promisify(execFile);
  const cli = new URL("../../eval/gate.mjs", import.meta.url).pathname;
  try {
    const baseline = join(directory, "baseline.jsonl");
    const candidate = join(directory, "candidate.json");
    const output = join(directory, "gate.json");
    await writeFile(
      baseline,
      records()
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    await writeFile(candidate, JSON.stringify(records()));
    const args = ["--baseline", baseline, "--candidate", candidate];
    const { stdout } = await run(process.execPath, [
      cli,
      ...args,
      "--output",
      output,
    ]);
    assert.equal(JSON.parse(stdout).pass, true);
    const artifact = await readFile(output, "utf8");
    assert.equal(JSON.parse(artifact).pass, true);
    assert.ok(!artifact.includes("/private/machine"));
    assert.ok(!artifact.includes("SENSITIVE SOURCE QUOTE"));
    await assert.rejects(
      run(process.execPath, [cli, ...args, "--mode", "improvement"]),
      { code: 1 },
    );
    await writeFile(candidate, JSON.stringify([record(0, false)]));
    await assert.rejects(run(process.execPath, [cli, ...args]), { code: 1 });
    await assert.rejects(run(process.execPath, [cli, "--baseline", baseline]), {
      code: 2,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
