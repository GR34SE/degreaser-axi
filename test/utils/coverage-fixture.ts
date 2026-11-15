import assert from "node:assert/strict";

import { queueFixture } from "./queue-fixture.ts";

export const ASPECT = "low-value-comments";

export const candidate = (path: string, quote: string, line = 1) => ({
  location: { path, side: "new", startLine: line, endLine: line },
  quote,
  title: "Redundant line",
});

export const found = (
  status: string,
  findings: object[] = [],
  extra: object = {},
) => ({
  result: {
    aspect: ASPECT,
    status,
    findings,
    limitations: status === "incomplete" ? ["Turn budget used."] : [],
    ...extra,
  },
});

const PAD = "export const pad = 0;\n".repeat(1200);

export function shardedFixture(
  t: Parameters<typeof queueFixture>[0],
  config: Parameters<typeof queueFixture>[1] = {},
) {
  const f = queueFixture(t, config);
  f.write("a.ts", `export const a = 1;\n${PAD}`);
  f.write("b.ts", `export const b = 2;\n${PAD}`);
  return f;
}

export const review = (f: ReturnType<typeof queueFixture>) => {
  f.start(["--aspects", ASPECT]);
  const done = f.finish();
  const task = f.state().tasks[0];
  assert.ok(task);
  return { done, task };
};

export const stage = (
  f: ReturnType<typeof queueFixture>,
  name: "find" | "verify",
) => f.events().filter((e) => e.stage === name);
