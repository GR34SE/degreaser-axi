import assert from "node:assert/strict";

import { queueFixture } from "./queue-fixture.ts";

export const finding = {
  location: { path: "b.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "export const b = 2;",
  title: "Duplicated constant",
  evidence: "Repeats a.ts.",
  consequence: "Two sources of truth.",
  countercheck: "No divergent use found.",
  recommendation: "Reuse a.ts.",
};

export const pass = (status: string, examinedPaths: string[], extra = {}) => ({
  result: {
    aspect: "low-value-comments",
    status,
    findings: [],
    limitations: status === "incomplete" ? ["Turn budget used."] : [],
    examinedPaths,
    ...extra,
  },
});

export function setup(
  t: Parameters<typeof queueFixture>[0],
  attempts: object[],
) {
  const f = queueFixture(t);
  f.write("a.ts", "export const a = 1;\n");
  f.write("b.ts", "export const b = 2;\n");
  f.setPlan({ workers: { "low-value-comments": { attempts } } });
  return f;
}

export const run = (f: ReturnType<typeof setup>) => {
  f.start(["--aspects", "low-value-comments"]);
  f.finish();
  const task = f.state().tasks[0];
  assert.ok(task?.result);
  return { ...task, result: task.result };
};

export const portionSizes = (prompts: readonly { prompt?: string }[]) =>
  prompts.map((event) => (event.prompt ?? "").match(/paths\[(\d+)\]:/)?.[1]);

export function writeSeries(f: ReturnType<typeof queueFixture>, count: number) {
  const names = Array.from(
    { length: count },
    (_, i) => `f${String(i).padStart(2, "0")}.ts`,
  );
  for (const name of names)
    f.write(name, `export const ${name.slice(0, -3)} = 1;\n`);
  return [...names, "source.ts"];
}

export const bFinding = {
  ...finding,
  location: { ...finding.location, path: "b.ts" },
};

export const openContext = {
  aspect: "low-value-comments",
  status: "incomplete",
  findings: [bFinding],
  limitations: ["Callers outside the assessed paths were not checked."],
  unresolved: [
    {
      scope: "context",
      reason: "Callers of the exported constant were not checked.",
      paths: ["b.ts"],
    },
  ],
};
