import assert from "node:assert/strict";
import test from "node:test";
import { queueFixture } from "./queue-fixture.ts";

const finding = {
  location: { path: "b.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "export const b = 2;",
  title: "Duplicated constant",
  evidence: "Repeats a.ts.",
  consequence: "Two sources of truth.",
  countercheck: "No divergent use found.",
  recommendation: "Reuse a.ts.",
};
const pass = (status: string, examinedPaths: string[], extra = {}) => ({
  result: {
    aspect: "low-value-comments",
    status,
    findings: [],
    limitations: status === "incomplete" ? ["Turn budget used."] : [],
    examinedPaths,
    ...extra,
  },
});
function setup(t: Parameters<typeof queueFixture>[0], attempts: object[]) {
  const f = queueFixture(t);
  f.write("a.ts", "export const a = 1;\n");
  f.write("b.ts", "export const b = 2;\n");
  f.setPlan({ workers: { "low-value-comments": { attempts } } });
  return f;
}
const run = (f: ReturnType<typeof setup>) => {
  f.start(["--aspects", "low-value-comments"]);
  f.finish();
  const task = f.state().tasks[0];
  assert.ok(task?.result);
  return { ...task, result: task.result };
};

test("an incomplete pass continues with a focused pass over only unexamined paths and merges", (t) => {
  const f = setup(t, [
    pass("incomplete", ["a.ts", "source.ts"]),
    pass("findings", ["b.ts"], { findings: [finding] }),
  ]);
  const task = run(f);
  assert.equal(task.status, "findings");
  assert.deepEqual(task.result.examinedPaths, ["a.ts", "source.ts", "b.ts"]);
  assert.equal(task.result.findings.length, 1);
  assert.equal(task.attempts.length, 2);
  const [first = "", second = ""] = f.events().map((e) => e.prompt as string);
  assert.doesNotMatch(first, /Focused coverage continuation/);
  const focus = second.slice(second.indexOf("# Focused coverage continuation"));
  assert.match(focus, /paths\[1\]: b\.ts/);
  assert.equal(f.state().status, "completed");
});

test("a clean claim without full coverage is not certified until the rest is examined", (t) => {
  const f = setup(t, [
    pass("not-applicable", [], { reason: "No comments." }),
    pass("not-applicable", ["a.ts", "b.ts", "source.ts"], {
      reason: "No comments.",
    }),
  ]);
  const task = run(f);
  assert.equal(task.status, "not-applicable");
  assert.equal(task.attempts.length, 2);
});

test("a pass without new coverage stops the loop and names the unexamined paths", (t) => {
  const f = setup(t, [
    pass("incomplete", ["a.ts"]),
    pass("incomplete", ["a.ts"]),
    pass("no-findings", ["b.ts", "source.ts"]),
  ]);
  const task = run(f);
  assert.equal(task.status, "incomplete");
  assert.equal(task.attempts.length, 2);
  assert.match(
    task.result.limitations.join(" "),
    /Unexamined assessed paths \(2\): b\.ts, source\.ts\./,
  );
  assert.equal(f.state().status, "partial");
});
