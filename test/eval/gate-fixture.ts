import assert from "node:assert/strict";

export function first<T>(values: T[]) {
  const [value] = values;
  assert.ok(value);
  return value;
}

export function record(index: number, hit = true, repeat = 0) {
  const sample = {
    id: `self/${index}`,
    family: "self",
    split: "dev",
    aspects: ["comments"],
    repo: { directory: "/private/machine/source" },
    review: { scope: "repository", task: "Review.", paths: ["a.ts"] },
    target: {
      report: [{ id: "r", path: "a.ts", lines: [3, 3] }],
      preserve: [{ id: "p", path: "a.ts", lines: [8, 8] }],
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
            limitations: [] as string[],
          },
        ],
        limitations: [] as string[],
      },
      meta: {
        sampleHash: `input-${index}`,
        productSha: "product-sha",
        agent: "claude",
        model: "haiku",
        durationMs: 100,
        sessionCount: 1,
      },
    },
  };
}

export type Row = ReturnType<typeof record>;

export const records = (
  count = 8,
  hit: (index: number) => boolean = () => true,
  repeats = 1,
) =>
  Array.from({ length: count }, (_, index) =>
    Array.from({ length: repeats }, (_, repeat) =>
      record(index, hit(index), repeat),
    ),
  ).flat();

export function partial(row: Row) {
  row.envelope.export.status = "partial";
  const coverage = first(row.envelope.export.coverage);
  coverage.status = "incomplete";
  coverage.examined = "0/1";
  Object.assign(row.envelope.meta, { outcome: "worker-quality-partial" });
}
