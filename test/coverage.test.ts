import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  assert.doesNotMatch(second, /a\.ts|source\.ts|<degreaser-patch-/);
  assert.match(second, /patchLines/);
  assert.equal(f.state().status, "completed");
});

test("a focused pass may repeat an accepted finding without rejection", (t) => {
  const accepted = {
    ...finding,
    location: { ...finding.location, path: "a.ts" },
    quote: "export const a = 1;",
  };
  const f = setup(t, [
    pass("incomplete", ["a.ts", "source.ts"], { findings: [accepted] }),
    pass("findings", ["b.ts"], { findings: [accepted] }),
  ]);
  const task = run(f);
  assert.equal(task.status, "findings");
  assert.deepEqual(task.result.findings, [accepted]);
  assert.deepEqual(task.rejections, []);
  assert.equal(f.state().status, "completed");
});

test("a clean claim without full coverage is not certified until the rest is examined", (t) => {
  const clean = (paths: string[]) =>
    pass("not-applicable", paths, { reason: "No comments." });
  // The unproductive first pass halves the portion, so the rest follows in pieces.
  const f = setup(t, [
    clean([]),
    clean(["a.ts"]),
    clean(["b.ts"]),
    clean(["source.ts"]),
  ]);
  const task = run(f);
  assert.equal(task.status, "not-applicable");
  assert.equal(task.attempts.length, 4);
});

test("a pass without progress shrinks its portion and the rest is still examined", (t) => {
  const f = setup(t, [
    pass("incomplete", ["a.ts"]),
    // Repeating the earlier path is not progress, and a repeated finding adds none.
    pass("incomplete", ["a.ts"], {
      findings: [
        {
          ...finding,
          location: { ...finding.location, path: "a.ts" },
          quote: "export const a = 1;",
        },
      ],
    }),
    pass("no-findings", ["b.ts"]),
    pass("no-findings", ["source.ts"]),
  ]);
  const task = run(f);
  assert.equal(task.status, "no-findings");
  assert.equal(task.attempts.length, 4);
  assert.equal(task.result.findings.length, 0);
  assert.equal(task.rejections[0]?.reason, "path-not-assessed");
  assert.equal(task.unresolved, undefined);
  const portions = f
    .events()
    .map((e) => (e.prompt ?? "").match(/paths\[(\d+)\]:/)?.[1]);
  assert.deepEqual(portions, [undefined, "2", "1", "1"]);
  assert.equal(f.state().status, "completed");
});

test("a path that makes no progress alone is recorded while other portions continue", (t) => {
  const f = setup(t, [
    pass("incomplete", ["a.ts"]),
    pass("incomplete", []),
    pass("incomplete", []),
    pass("no-findings", ["source.ts"]),
  ]);
  const task = run(f);
  assert.equal(task.status, "incomplete");
  assert.equal(task.attempts.length, 4);
  assert.deepEqual(task.result.examinedPaths, ["a.ts", "source.ts"]);
  assert.deepEqual(task.unresolved, {
    cause: "no-progress",
    paths: ["b.ts"],
    stuck: ["b.ts"],
  });
  assert.match(
    task.result.limitations.join(" "),
    /Unexamined assessed paths \(1\): b\.ts\./,
  );
  assert.equal(f.state().status, "partial");
  const report = f.run(["report", f.state().id, "--full"]);
  assert.equal(report.status, 1);
  assert.match(report.stdout, /no-progress/);
});

test("portions are bounded by the turn budget and each pass sees only its own paths", (t) => {
  const f = queueFixture(t, { limits: { maxTurns: 4 } });
  const names = ["a", "b", "c", "d", "e"].map((n) => `${n}.ts`);
  for (const name of names) f.write(name, `export const ${name[0]} = 1;\n`);
  f.setPlan({ workers: { "low-value-comments": { attempts: [] } } });
  f.start(["--aspects", "low-value-comments"]);
  f.finish();
  const task = f.state().tasks[0];
  assert.equal(task?.status, "no-findings");
  const prompts = f.events().map((e) => e.prompt ?? "");
  assert.deepEqual(
    prompts.map((p) => p.match(/paths\[(\d+)\]:/)?.[1]),
    ["2", "2", "2"],
  );
  assert.ok(prompts.every((p) => !p.includes("<degreaser-patch-")));
  assert.match(prompts[0] ?? "", /\d+ more paths are left for later passes/);
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
          ...[0, 1, 2].map(() => ({
            result: { ...a08("not-applicable", []).result, reason: "None." },
          })),
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

const bFinding = {
  ...finding,
  location: { ...finding.location, path: "b.ts" },
};
const openContext = {
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

test("full declared coverage with a structured unresolved reason stays incomplete and resume targets it", (t) => {
  const f = setup(t, []);
  f.setPlan({ results: { "low-value-comments": openContext } });
  const task = run(f);
  assert.equal(task.status, "incomplete");
  assert.equal(task.attempts.length, 1);
  assert.deepEqual(task.result.examinedPaths, ["a.ts", "b.ts", "source.ts"]);
  assert.deepEqual(task.unresolved, {
    cause: "declared-unresolved",
    paths: [],
  });
  assert.equal(f.state().status, "partial");
  const report = f.run(["report", f.state().id]);
  assert.equal(report.status, 1);
  assert.match(report.stdout, /stopCause: declared-unresolved/);
  assert.match(report.stdout, /Callers of the exported constant/);

  f.setPlan({
    workers: { "low-value-comments": { attempts: [pass("no-findings", [])] } },
  });
  const resumed = f.run([
    "resume",
    f.state().id,
    "--deadline",
    "20",
    "--wait",
    "20",
  ]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const after = f.state().tasks[0];
  assert.equal(after?.status, "findings");
  assert.equal(after?.result?.findings.length, 1);
  assert.equal(after?.result?.unresolved, undefined);
  assert.equal(after?.unresolved, undefined);
  const prompt = f.events().at(-1)?.prompt ?? "";
  const focus = prompt.slice(prompt.indexOf("# Unresolved obligations"));
  assert.match(focus, /Callers of the exported constant/);
  assert.match(focus, /paths\[1\]: b\.ts/);
  assert.doesNotMatch(prompt, /a\.ts|source\.ts/);
});

test("an incomplete resolving pass keeps the open obligation instead of dropping it", (t) => {
  const f = setup(t, []);
  f.setPlan({ results: { "low-value-comments": openContext } });
  run(f);
  f.setPlan({ results: { "low-value-comments": openContext } });
  const resumed = f.run([
    "resume",
    f.state().id,
    "--deadline",
    "20",
    "--wait",
    "20",
  ]);
  assert.equal(resumed.status, 1, resumed.stdout);
  const task = f.state().tasks[0];
  assert.equal(task?.status, "incomplete");
  assert.equal(task?.attempts.length, 2);
  assert.equal(task?.result?.findings.length, 1);
  assert.equal(task?.result?.unresolved?.length, 1);
});

test("a legacy incomplete result without structured unresolved work stays readable and restarts the aspect", (t) => {
  const f = setup(t, []);
  f.setPlan({
    results: {
      "low-value-comments": {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [],
        limitations: ["One construct remains."],
      },
    },
  });
  run(f);
  const old = f.state();
  const path = join(f.root, ".degreaser/runs", old.id, "run.json");
  const legacy = JSON.parse(readFileSync(path, "utf8"));
  for (const task of legacy.tasks) {
    delete task.unresolved;
    delete task.result.unresolved;
    for (const attempt of task.attempts) delete attempt.result?.unresolved;
  }
  writeFileSync(path, JSON.stringify(legacy));
  assert.equal(f.run(["report", old.id]).status, 1);
  f.setPlan();
  const resumed = f.run(["resume", old.id, "--deadline", "20", "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const prompt = f.events().at(-1)?.prompt ?? "";
  assert.doesNotMatch(prompt, /Unresolved obligations|Focused coverage/);
  assert.equal(f.state().tasks[0]?.status, "no-findings");
});

test("a run deadline is reported as its own cause, keeps the pending paths and resume continues them", (t) => {
  const f = queueFixture(t, {
    concurrency: 1,
    limits: { maxTurns: 4, workerTimeoutSeconds: 60, runTimeoutSeconds: 6 },
  });
  for (const name of ["a", "b", "c", "d", "e"])
    f.write(`${name}.ts`, `export const ${name} = 1;\n`);
  f.setPlan({
    workers: {
      "low-value-comments": { attempts: [{}, { hang: true }] },
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  f.finish();
  const old = f.state();
  const task = old.tasks[0];
  assert.equal(old.executions?.at(-1)?.stopReason, "deadline");
  assert.equal(task?.status, "cancelled");
  assert.equal(task?.result?.examinedPaths?.length, 2);
  assert.equal(task?.unresolved?.cause, "deadline");
  assert.equal(task?.unresolved?.paths.length, 4);
  assert.equal(task?.unresolved?.stuck, undefined);
  const report = f.run(["report", old.id]);
  assert.match(report.stdout, /stopCause: deadline/);
  assert.match(report.stdout, /pending: 4/);

  f.setPlan();
  const before = f.events().length;
  const resumed = f.run(["resume", old.id, "--deadline", "30", "--wait", "30"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const after = f.state().tasks[0];
  assert.equal(after?.status, "no-findings");
  assert.equal(after?.unresolved, undefined);
  assert.equal(after?.result?.examinedPaths?.length, 6);
  const first = f.events()[before]?.prompt ?? "";
  assert.match(first, /examined 2 paths/);
});
