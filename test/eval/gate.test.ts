import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { compareRuns } from "../../eval/gate.mjs";

function first<T>(values: T[]) {
  const [value] = values;
  assert.ok(value);
  return value;
}

function record(index: number, hit = true, family = "self", repeat = 0) {
  const sample = {
    id: `${family}/${index}`,
    family,
    split: "holdout",
    labelKind: "synthetic",
    aspects: ["comments"],
    repo: { directory: "/private/machine/source" },
    review: { scope: "repository", task: "Review.", paths: ["a.ts"] },
    provenance: { source: family, revision: `source-${index}` },
    target: {
      report: [{ id: "r", path: "a.ts", lines: [3, 3] }],
      preserve: [{ id: "p", path: "a.ts", lines: [8, 8] }],
      forbidden: [{ id: "f", pattern: "delete safety" }],
    },
  };
  return {
    sample,
    repeat,
    envelope: {
      sampleId: sample.id,
      export: {
        schemaVersion: 1,
        run: "run",
        status: "completed",
        scope: "repository",
        task: "Review.",
        base: null,
        tree: "tree",
        coverageBasis: "worker-declared",
        findings: [
          {
            id: "F1",
            group: "G1",
            aspect: "comments",
            path: "a.ts",
            side: "new",
            startLine: hit ? 3 : 20,
            endLine: hit ? 3 : 20,
            title: "Comment",
            quote: "SENSITIVE SOURCE QUOTE",
            evidence: "Repeated code.",
            consequence: "Noise.",
            countercheck: "No requirement.",
            recommendation: "Remove comment.",
          },
        ],
        coverage: [
          {
            aspect: "comments",
            status: "findings",
            examined: "1/1",
            rejected: 0,
            limitations: [],
          },
        ],
        limitations: [],
      },
      meta: {
        sampleHash: `input-${index}-${family}`,
        productSha: "product-sha",
        agent: "claude",
        model: "haiku",
        durationMs: 100,
        sessionCount: 1,
      },
    },
  };
}

const records = () =>
  Array.from({ length: 6 }, (_, index) => record(index, index % 2 === 0));

test("perfectly paired unchanged samples pass non-regression without claiming improvement", () => {
  const baseline = records();
  const candidate = structuredClone(baseline);
  for (const row of candidate)
    row.sample.repo.directory = "/different/machine/source";
  const result = compareRuns(baseline, candidate);
  assert.equal(result.pass, true);
  assert.equal(result.improved, false);
  const recall = first(result.families).metrics.recall;
  assert.ok(recall);
  assert.equal(recall.baseline, 0.5);
  assert.equal(recall.candidate, 0.5);
  assert.deepEqual(recall.interval95, [0, 0]);
  assert.equal(
    compareRuns(baseline, candidate, { mode: "improvement" }).pass,
    false,
  );
});

test("checks every family, not an average which hides a regression", () => {
  const baseline = [
    ...Array.from({ length: 20 }, (_, i) => record(i, false, "large")),
    ...Array.from({ length: 4 }, (_, i) => record(i, true, "small")),
  ];
  const candidate = baseline.map((row) =>
    record(
      Number(row.sample.id.split("/")[1]),
      row.sample.family === "large",
      row.sample.family,
    ),
  );
  const result = compareRuns(baseline, candidate);
  assert.equal(result.pass, false);
  assert.equal(result.status, "regressed");
  const small = result.families.find(
    (family: { family: string }) => family.family === "small",
  );
  assert.ok(small?.metrics.recall);
  assert.equal(small.metrics.recall.delta, -1);
});

test("paired quality improvement can accept a campaign explicitly", () => {
  const baseline = Array.from({ length: 6 }, (_, i) => record(i, false));
  const candidate = Array.from({ length: 6 }, (_, i) => record(i, true));
  const result = compareRuns(baseline, candidate, { mode: "improvement" });
  assert.equal(result.pass, true);
  assert.equal(result.improved, true);
});

test("repeated model attempts do not create independent source samples", () => {
  const baseline = Array.from({ length: 20 }, (_, repeat) =>
    record(1, true, "self", repeat),
  );
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.equal(result.pass, false);
  assert.equal(result.status, "inconclusive");
  assert.equal(first(result.families).metrics.recall?.clusters, 1);
});

test("blocks mismatched identities, missing and duplicate pairs, and inconsistent repetition sets", () => {
  const baseline = records();
  const mutations = [
    (rows: ReturnType<typeof records>) => {
      rows.pop();
    },
    (rows: ReturnType<typeof records>) => {
      rows.push(structuredClone(first(rows)));
    },
    (rows: ReturnType<typeof records>) => {
      first(rows).envelope.meta.sampleHash = "other";
    },
    (rows: ReturnType<typeof records>) => {
      first(rows).sample.provenance.revision = "changed";
    },
    (rows: ReturnType<typeof records>) => {
      first(first(rows).sample.target.report).lines = [4, 4];
    },
    (rows: ReturnType<typeof records>) => {
      first(rows).envelope.meta.model = "other";
    },
    (rows: ReturnType<typeof records>) => {
      first(rows).envelope.meta.agent = "other";
    },
    (rows: ReturnType<typeof records>) => {
      Object.assign(first(rows).envelope.meta, { productHash: "a".repeat(64) });
    },
    (rows: ReturnType<typeof records>) => {
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

test("no records, errors, incomplete outputs and unsupported denominators fail closed", () => {
  assert.equal(compareRuns([], []).pass, false);
  assert.equal(compareRuns([{}], [{}]).pass, false);
  const baseline = records();
  const candidate = structuredClone(baseline);
  first(candidate).envelope.export.status = "partial";
  assert.equal(compareRuns(baseline, candidate).pass, false);
  const empty = records();
  for (const row of empty) row.sample.target.preserve = [];
  const result = compareRuns(empty, structuredClone(empty));
  assert.equal(result.pass, false);
  assert.equal(
    first(result.families).metrics.preserveRate?.status,
    "unsupported",
  );
  assert.equal(
    compareRuns(baseline, baseline, { metrics: ["semanticPrecision"] }).pass,
    false,
  );
});

test("sentinels and resource budgets are hard gates", () => {
  const baseline = records();
  for (const mutate of [
    (row: ReturnType<typeof record>) => {
      first(row.envelope.export.findings).recommendation = "Delete safety";
    },
    (row: ReturnType<typeof record>) => {
      row.envelope.meta.sessionCount = 2;
    },
    (row: ReturnType<typeof record>) => {
      row.envelope.meta.durationMs = 116;
    },
  ]) {
    const candidate = structuredClone(baseline);
    candidate.forEach(mutate);
    assert.equal(compareRuns(baseline, candidate).pass, false);
  }
  const candidate = structuredClone(baseline);
  for (const row of candidate) row.envelope.meta.durationMs = 115;
  assert.equal(compareRuns(baseline, candidate).pass, true);
});

test("paired uncertainty, not the point difference, controls acceptance", () => {
  const baseline = records();
  const candidate = structuredClone(baseline);
  first(candidate).envelope.export.findings = record(
    0,
    false,
  ).envelope.export.findings;
  const second = candidate.at(1);
  assert.ok(second);
  second.envelope.export.findings = record(1, true).envelope.export.findings;
  const result = compareRuns(baseline, candidate);
  const recall = first(result.families).metrics.recall;
  assert.ok(recall);
  assert.equal(recall.delta, 0);
  assert.equal(recall.status, "inconclusive");
  assert.equal(result.pass, false);
});

test("slices sharing an explicit dataset cluster cannot inflate confidence", () => {
  const baseline = records().map((row) => ({
    ...row,
    sample: { ...row.sample, cluster: "one-repository" },
  }));
  const result = compareRuns(baseline, structuredClone(baseline));
  assert.equal(result.pass, false);
  assert.equal(first(result.families).metrics.recall?.clusters, 1);
});

test("applies the recall and preserve three-percentage-point margins", () => {
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
    row.envelope.export.findings = row.sample.target.report.map(
      (anchor, i) => ({
        ...finding,
        id: `F${i + 1}`,
        startLine: i + 1,
        endLine: i + 1,
        title: anchor.id,
      }),
    );
  }
  for (const lost of [3, 4]) {
    const candidate = structuredClone(baseline);
    for (const row of candidate) {
      for (const finding of row.envelope.export.findings.slice(0, lost)) {
        finding.startLine += 10000;
        finding.endLine += 10000;
      }
    }
    assert.equal(compareRuns(baseline, candidate).pass, lost === 3);
  }
  for (const touched of [3, 4]) {
    const candidate = structuredClone(baseline);
    for (const row of candidate)
      first(row.envelope.export.findings).evidence = Array.from(
        { length: touched },
        (_, i) => `a.ts:${i + 1000}`,
      ).join(" ");
    assert.equal(compareRuns(baseline, candidate).pass, touched === 3);
  }
});

test("JSON gate CLI writes portable redacted artifacts and meaningful exit codes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-gate-"));
  try {
    const baseline = join(directory, "baseline.json");
    const candidate = join(directory, "candidate.json");
    const output = join(directory, "gate.json");
    await writeFile(baseline, JSON.stringify(records()));
    await writeFile(candidate, JSON.stringify(records()));
    const cli = new URL("../../eval/gate.mjs", import.meta.url).pathname;
    const { stdout } = await promisify(execFile)(process.execPath, [
      cli,
      "--baseline",
      baseline,
      "--candidate",
      candidate,
      "--output",
      output,
    ]);
    assert.equal(JSON.parse(stdout).pass, true);
    const artifact = await readFile(output, "utf8");
    assert.equal(JSON.parse(artifact).pass, true);
    assert.ok(!artifact.includes("/private/machine"));
    assert.ok(!artifact.includes("SENSITIVE SOURCE QUOTE"));
    await writeFile(candidate, "{}");
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        cli,
        "--baseline",
        baseline,
        "--candidate",
        candidate,
      ]),
      { code: 1 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
