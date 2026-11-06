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

test("scope-creep not-applicable follows the task's feature scope without path coverage", (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      "scope-creep": {
        result: {
          aspect: "scope-creep",
          status: "not-applicable",
          findings: [],
          limitations: [],
          reason: "The task has no feature scope.",
          examinedPaths: [],
        },
      },
    },
  });
  f.start(["--aspects", "scope-creep"]);
  f.finish();
  const task = f.state().tasks[0];
  assert.equal(task?.status, "not-applicable");
  assert.equal(task?.attempts.length, 1);
});

test("a final not-applicable pass cannot relabel an aspect earlier passes found applicable", (t) => {
  const f = setup(t, [
    pass("incomplete", ["a.ts"]),
    pass("not-applicable", ["b.ts", "source.ts"], { reason: "Only a chart." }),
  ]);
  const task = run(f);
  assert.equal(task.status, "no-findings");
  assert.equal(task.result.reason, undefined);
});

test("paths of rejected findings are not covered, so a focused pass judges them again", (t) => {
  const f = setup(t, [
    pass("findings", ["a.ts", "source.ts"], {
      findings: [
        { ...finding, location: { ...finding.location, path: "a.ts" } },
      ],
    }),
    pass("no-findings", ["a.ts", "b.ts"]),
  ]);
  const task = run(f);
  const second = f.events().map((e) => e.prompt as string)[1] ?? "";
  const focus = second.slice(second.indexOf("# Focused coverage continuation"));
  assert.match(focus, /paths\[2\]: a\.ts,b\.ts/);
  assert.equal(task.status, "no-findings");
  assert.equal(task.rejections.length, 1);
});

test("a worker cleanup failure stops coverage continuation and certifies nothing", (t) => {
  const f = queueFixture(t, { agent: "pi", model: "openai/gpt-6-luna" });
  f.write("a.ts", "export const a = 1;\n");
  f.write("b.ts", "export const b = 2;\n");
  f.setPlan({
    workers: {
      "low-value-comments": {
        closeError: { message: "Synthetic close failure", code: -32603 },
        attempts: [
          pass("incomplete", ["a.ts"]),
          pass("no-findings", ["b.ts", "source.ts"]),
        ],
      },
    },
  });
  const task = run(f);
  assert.equal(task.attempts.length, 1);
  assert.equal(task.status, "incomplete");
  assert.deepEqual(task.result.examinedPaths, []);
});

test("scope-creep not-applicable cannot skip coverage once an earlier pass found it applicable", (t) => {
  const f = setup(t, []);
  const a08 = (status: string, examinedPaths: string[]) => ({
    result: { ...pass(status, examinedPaths).result, aspect: "scope-creep" },
  });
  f.setPlan({
    workers: {
      "scope-creep": {
        attempts: [
          a08("incomplete", ["a.ts"]),
          { result: { ...a08("not-applicable", []).result, reason: "None." } },
        ],
      },
    },
  });
  f.start(["--aspects", "scope-creep"]);
  f.finish();
  assert.equal(f.state().tasks[0]?.status, "incomplete");
});

test("both names of a renamed path count as one examined path across passes", (t) => {
  const f = queueFixture(t);
  const body = Array.from(
    { length: 20 },
    (_, i) => `export const v${i} = ${i};`,
  );
  f.write("old.ts", `${body.join("\n")}\n`);
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Rename base");
  f.git("mv", "old.ts", "new.ts");
  f.write("new.ts", `${[...body, "export const extra = 1;"].join("\n")}\n`);
  f.write("source.ts", "// redundant\nexport const value = 2;\n");
  f.setPlan({
    workers: {
      "low-value-comments": {
        attempts: [
          pass("incomplete", ["new.ts"]),
          pass("incomplete", ["old.ts"]),
        ],
      },
    },
  });
  const task = run(f);
  assert.equal(task.attempts.length, 2);
  assert.deepEqual(task.result.examinedPaths, ["new.ts"]);
});
