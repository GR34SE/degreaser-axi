import assert from "node:assert/strict";

export function first<T>(values: T[]) {
  const [value] = values;
  assert.ok(value);
  return value;
}

export function record(index: number, hit = true, family = "self", repeat = 0) {
  const sample = {
    id: `${family}/${index}`,
    family,
    cluster: `${family}-${index}`,
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

export const records = () =>
  Array.from({ length: 6 }, (_, index) => record(index, index % 2 === 0));

export function partial(row: ReturnType<typeof record>) {
  row.envelope.export.status = "partial";
  const coverage = first(row.envelope.export.coverage);
  coverage.status = "incomplete";
  coverage.examined = "0/1";
}
