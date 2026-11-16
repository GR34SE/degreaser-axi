import assert from "node:assert/strict";

import test from "node:test";
import {
  ASPECT,
  candidate,
  found,
  review,
  shardedFixture,
  stage,
} from "../utils/coverage-fixture.ts";
import { queueFixture } from "../utils/queue-fixture.ts";
import { decode } from "../utils/report-fixture.ts";

const sorted = (paths: readonly string[] | undefined) =>
  [...(paths ?? [])].sort();

test("a scope larger than one shard runs one finder per shard, covers every path and counts retries as one finder", (t) => {
  const f = shardedFixture(t, { maxRetries: 1 });
  const usage = { inputTokens: 10, outputTokens: 2 };
  f.setPlan({
    workers: {
      [ASPECT]: {
        usage,
        paths: { "a.ts": { attempts: [{ result: "", usage }, { usage }] } },
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(task.status, "no-findings");
  assert.deepEqual(sorted(task.result?.examinedPaths), [
    "a.ts",
    "b.ts",
    "source.ts",
  ]);
  const finders = stage(f, "find");
  assert.deepEqual(finders.map((e) => e.paths).sort(), [
    ["a.ts"],
    ["a.ts"],
    ["b.ts", "source.ts"],
  ]);
  const first = finders.find((e) => e.paths?.[0] === "a.ts")?.prompt ?? "";
  const second = finders.find((e) => e.paths?.[0] === "b.ts")?.prompt ?? "";
  assert.match(first, /export const a = 1;/);
  assert.doesNotMatch(first, /export const b = 2;/);
  assert.match(second, /export const b = 2;/);
  assert.doesNotMatch(second, /export const a = 1;/);
  assert.deepEqual(stage(f, "verify"), []);
  const report = decode(f.run(["report"]).stdout);
  assert.equal(report.coverage[0].stages, "2 finders");
  assert.deepEqual(report.usage, { inputTokens: 30, outputTokens: 6 });
  assert.equal(f.state().status, "completed");
});

test("refuted findings stay out of the default report, appear with their reason in report --full and cannot be dismissed", (t) => {
  const f = queueFixture(t);
  const refutation = {
    verdict: "refuted",
    reason: "The comment records a constraint.",
    evidence: {
      location: { path: "source.ts", side: "new", startLine: 2, endLine: 2 },
      quote: "export const value = 1;",
    },
  };
  f.setPlan({
    workers: {
      [ASPECT]: {
        ...found("findings", [
          candidate("source.ts", "// redundant", 1),
          candidate("source.ts", "export const value = 1;", 2),
        ]),
        verifier: { verdicts: [refutation, "upheld"] },
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(task.status, "findings");
  const short = decode(done.stdout);
  assert.deepEqual([short.upheld, short.refuted, short.unverified], [1, 1, 0]);
  assert.deepEqual(short.findings, {
    "source.ts": [
      { id: "F2", aspect: ASPECT, lines: "new:2-2", action: "Remove it." },
    ],
  });
  assert.ok(short.help.includes(`degreaser-axi report ${short.run} --full`));
  const full = decode(f.run(["report", "--full"]).stdout);
  assert.deepEqual(
    full.findings.map((x: { id: string; verdict: string }) => [
      x.id,
      x.verdict,
    ]),
    [
      ["F1", "refuted"],
      ["F2", "upheld"],
    ],
  );
  assert.equal(full.findings[0].reason, refutation.reason);
  assert.deepEqual(full.findings[0].evidence, {
    at: "source.ts:new:2-2",
    quote: "export const value = 1;",
  });
  const home = decode(f.run(["home"]).stdout);
  assert.deepEqual([home.upheld, home.refuted, home.unverified], [1, 1, 0]);
  const refused = f.run(["dismiss", "F1", "--reason", "Keep it"]);
  assert.equal(refused.status, 2, refused.stdout);
  assert.equal(decode(refused.stdout).code, "finding-not-upheld");
  const kept = f.run(["dismiss", "F2", "--reason", "Keep it"]);
  assert.equal(kept.status, 0, kept.stdout);
});

const evidence = {
  location: { path: "source.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "not in the source",
};
for (const [name, verifier, cause, trace] of [
  [
    "a missing verdict",
    { verdicts: ["omit"] },
    "unverified",
    /without a valid verdict/,
  ],
  [
    "malformed verifier output",
    { result: "no result block" },
    "invalid-output",
    /Missing final result block/,
  ],
  [
    "a verdict with a wrong evidence quote",
    { verdicts: [{ evidence }] },
    "unverified",
    /unmatched evidence quote/,
  ],
] as const) {
  test(`${name} leaves the finding unverified, the aspect incomplete and the run partial`, (t) => {
    const f = queueFixture(t);
    f.setPlan({
      workers: {
        [ASPECT]: {
          ...found("findings", [candidate("source.ts", "// redundant")]),
          verifier,
        },
      },
    });
    const { done, task } = review(f);
    assert.equal(done.status, 1, done.stdout);
    assert.equal(f.state().status, "partial");
    assert.equal(task.status, "incomplete");
    assert.deepEqual(task.unresolved, { cause, paths: [] });
    assert.deepEqual(
      task.result?.findings.map((x) => x.verdict),
      ["unverified"],
    );
    assert.match(JSON.stringify(task), trace);
    const short = decode(done.stdout);
    assert.deepEqual(
      [short.upheld, short.refuted, short.unverified],
      [0, 0, 1],
    );
    assert.deepEqual(short.findings, {});
    const full = decode(f.run(["report", "--full"]).stdout);
    assert.equal(full.findings[0].verdict, "unverified");
    const home = decode(f.run(["home"]).stdout);
    assert.deepEqual([home.upheld, home.refuted, home.unverified], [0, 0, 1]);
    const refused = f.run(["dismiss", "F1", "--reason", "Keep it"]);
    assert.equal(refused.status, 2, refused.stdout);
    assert.equal(decode(refused.stdout).code, "finding-not-upheld");
  });
}

test("resume reruns only uncovered shards and unverified findings and never replays a settled verdict", (t) => {
  const f = shardedFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: {
        paths: {
          "a.ts": found("findings", [
            candidate("a.ts", "export const a = 1;", 1),
            candidate("a.ts", "export const pad = 0;", 2),
          ]),
          "b.ts": { error: { message: "Cannot decode provider response" } },
        },
        verifier: { verdicts: ["upheld", "omit"] },
      },
    },
  });
  const { done, task: old } = review(f);
  assert.equal(done.status, 1, done.stdout);
  assert.equal(old.status, "incomplete");
  assert.deepEqual(sorted(old.unresolved?.paths), ["b.ts", "source.ts"]);
  assert.deepEqual(
    old.result?.findings.map((x) => x.verdict),
    ["upheld", "unverified"],
  );
  const before = f.events().length;
  f.setPlan();
  const resumed = f.run(["resume", f.state().id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const fresh = f.events().slice(before);
  assert.deepEqual(
    fresh.filter((e) => e.stage === "find").map((e) => e.paths),
    [["b.ts", "source.ts"]],
  );
  assert.deepEqual(
    fresh
      .filter((e) => e.stage === "verify")
      .map((e) => e.candidates?.map((c) => c.quote)),
    [["export const pad = 0;"]],
  );
  const task = f.state().tasks[0];
  assert.equal(task?.status, "findings");
  assert.deepEqual(task?.result?.findings[0], old.result?.findings[0]);
  assert.equal(task?.result?.findings[1]?.verdict, "upheld");
  assert.deepEqual(sorted(task?.result?.examinedPaths), [
    "a.ts",
    "b.ts",
    "source.ts",
  ]);
  assert.deepEqual(task?.attempts.slice(0, old.attempts.length), old.attempts);
});

test("the concurrency cap holds across finder and verifier workers", (t) => {
  const f = queueFixture(t, { concurrency: 2 });
  const aspects = ["masked-errors", "convention-drift", ASPECT];
  f.setPlan({
    delayMs: 300,
    results: Object.fromEntries(
      aspects.map((aspect) => [
        aspect,
        {
          ...found("findings", [candidate("source.ts", "// redundant")]).result,
          aspect,
        },
      ]),
    ),
  });
  f.start(["--aspects", aspects.join(",")]);
  assert.equal(f.finish().status, 0);
  assert.equal(stage(f, "find").length, 3);
  assert.equal(stage(f, "verify").length, 3);
  const spans = [...Map.groupBy(f.lifecycle(), (e) => e.pid).values()].map(
    (events) => [
      events.find((e) => e.type === "prompt")?.time ?? Number.NaN,
      events.find((e) => e.type === "result")?.time ?? Number.NaN,
    ],
  );
  assert.equal(spans.length, 6);
  const peak = Math.max(
    ...spans.map(
      ([start = 0]) =>
        spans.filter(([from = 0, to = 0]) => from <= start && start < to)
          .length,
    ),
  );
  assert.ok(peak >= 1 && peak <= 2, `peak ${peak}`);
});

test("a run deadline is reported as its own cause, keeps the pending shard and resume finishes only that shard", (t) => {
  const f = shardedFixture(t, {
    concurrency: 1,
    limits: { workerTimeoutSeconds: 60, runTimeoutSeconds: 6 },
  });
  f.setPlan({ workers: { [ASPECT]: { paths: { "b.ts": { hang: true } } } } });
  const { task } = review(f);
  const old = f.state();
  assert.equal(old.executions?.at(-1)?.stopReason, "deadline");
  assert.equal(task.status, "incomplete");
  assert.deepEqual(task.result?.examinedPaths, ["a.ts"]);
  assert.deepEqual(task.unresolved, {
    cause: "deadline",
    paths: ["b.ts", "source.ts"],
  });
  const report = f.run(["report", old.id]);
  assert.match(report.stdout, /stopCause: deadline/);
  assert.match(report.stdout, /pending: 2/);
  f.setPlan();
  const before = f.events().length;
  const resumed = f.run(["resume", old.id, "--deadline", "30", "--wait", "30"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.deepEqual(
    f
      .events()
      .slice(before)
      .map((e) => e.paths),
    [["b.ts", "source.ts"]],
  );
  const after = f.state().tasks[0];
  assert.equal(after?.status, "no-findings");
  assert.equal(after?.unresolved, undefined);
});

test("a worker cleanup failure certifies no coverage for its shard", (t) => {
  const f = queueFixture(t, {
    agent: "pi",
    model: "openai/gpt-6-luna",
    verifier: { model: "openai/gpt-6-sol" },
  });
  f.setPlan({
    workers: {
      [ASPECT]: {
        closeError: { message: "Synthetic close failure", code: -32603 },
      },
    },
  });
  const { task } = review(f);
  assert.equal(task.attempts.length, 1);
  assert.equal(task.attempts[0]?.failure, "cleanup");
  assert.equal(task.status, "incomplete");
  assert.deepEqual(task.result?.examinedPaths, []);
});

test("an aspect is not applicable only when every shard says so", (t) => {
  const reason = { reason: "No comments in this shard." };
  for (const [other, status] of [
    [found("not-applicable", [], reason), "not-applicable"],
    [found("no-findings"), "no-findings"],
  ] as const) {
    const f = shardedFixture(t);
    f.setPlan({
      workers: {
        [ASPECT]: {
          ...found("not-applicable", [], reason),
          paths: { "b.ts": other },
        },
      },
    });
    const { done, task } = review(f);
    assert.equal(done.status, 0, done.stdout);
    assert.equal(task.status, status);
    assert.equal(
      task.result?.reason,
      status === "not-applicable" ? reason.reason : undefined,
    );
    assert.deepEqual(stage(f, "verify"), []);
  }
});

test("a shard whose every candidate fails quote validation stays uncovered", (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: found("findings", [candidate("source.ts", "invented quote")]),
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 1, done.stdout);
  assert.equal(task.status, "incomplete");
  assert.deepEqual(task.result?.findings, []);
  assert.deepEqual(task.rejections, [{ index: 1, reason: "quote-mismatch" }]);
  assert.deepEqual(task.unresolved?.paths, ["source.ts"]);
  assert.deepEqual(stage(f, "verify"), []);
});

test("a rejected candidate keeps its path uncovered even when a sibling candidate survives", (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: found("findings", [
        candidate("source.ts", "// redundant"),
        candidate("source.ts", "invented quote", 2),
      ]),
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 1, done.stdout);
  assert.equal(task.status, "incomplete");
  assert.deepEqual(
    task.result?.findings.map((x) => [x.quote, x.verdict]),
    [["// redundant", "upheld"]],
  );
  assert.deepEqual(task.rejections, [{ index: 2, reason: "quote-mismatch" }]);
  assert.deepEqual(task.unresolved?.paths, ["source.ts"]);
});

test("verdicts from a verifier that did not finish cleanly are not applied", (t) => {
  const f = queueFixture(t, {
    agent: "pi",
    model: "openai/gpt-6-luna",
    verifier: { model: "openai/gpt-6-sol" },
  });
  f.setPlan({
    workers: {
      [ASPECT]: {
        ...found("findings", [candidate("source.ts", "// redundant")]),
        closeError: { message: "Synthetic close failure", code: -32603 },
      },
    },
  });
  const { task } = review(f);
  const verifiers = task.attempts.filter((a) => a.stage === "verify");
  assert.equal(verifiers.length, 1);
  assert.equal(verifiers[0]?.failure, "cleanup");
  assert.equal(task.status, "incomplete");
  assert.deepEqual(
    task.result?.findings.map((x) => x.verdict),
    ["unverified"],
  );
});
