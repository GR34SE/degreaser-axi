import assert from "node:assert/strict";

import test from "node:test";
import {
  ASPECT,
  candidate,
  found,
  paddedFixture,
  review,
  stage,
} from "../utils/coverage-fixture.ts";
import { queueFixture } from "../utils/queue-fixture.ts";
import { decode } from "../utils/report-fixture.ts";

const sorted = (paths: readonly string[] | undefined) =>
  [...(paths ?? [])].sort();

test("one finder session reviews the whole scope with tools, nothing inline, and a retry counts as a new attempt of the same session", (t) => {
  const f = paddedFixture(t, { maxRetries: 1 });
  const usage = { inputTokens: 10, outputTokens: 2 };
  f.setPlan({
    workers: {
      [ASPECT]: { attempts: [{ result: "", usage }, { usage }] },
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
  assert.deepEqual(
    finders.map((e) => sorted(e.paths)),
    [
      ["a.ts", "b.ts", "source.ts"],
      ["a.ts", "b.ts", "source.ts"],
    ],
  );
  for (const finder of finders) {
    assert.doesNotMatch(finder.prompt ?? "", /export const (a|b) = /);
    assert.match(finder.prompt ?? "", /patch\.diff/);
  }
  assert.deepEqual(stage(f, "verify"), []);
  assert.deepEqual(task.usage, { inputTokens: 20, outputTokens: 4 });
  assert.equal(f.state().status, "completed");
});

test("paths the finder did not examine are recorded, not a reason for an incomplete aspect", (t) => {
  const f = paddedFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: found("no-findings", [], {
        examinedPaths: ["source.ts", "elsewhere.ts"],
      }),
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(task.status, "no-findings");
  assert.deepEqual(task.result?.examinedPaths, ["source.ts"]);
  assert.match(
    task.result?.limitations.join(" ") ?? "",
    /Ignored 1 examined path/,
  );
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
  test(`${name} leaves the finding unverified without making the run partial`, (t) => {
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
    assert.equal(done.status, 0, done.stdout);
    assert.equal(f.state().status, "completed");
    assert.equal(task.status, "findings");
    assert.equal(task.unresolved, undefined);
    assert.equal(
      task.attempts.filter((a) => a.stage === "verify").at(-1)?.failure ??
        "unverified",
      cause,
    );
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
    const full = decode(f.run(["report", "--full"]).stdout);
    assert.equal(full.findings[0].verdict, "unverified");
    const home = decode(f.run(["home"]).stdout);
    assert.deepEqual([home.upheld, home.refuted, home.unverified], [0, 0, 1]);
    const refused = f.run(["dismiss", "F1", "--reason", "Keep it"]);
    assert.equal(refused.status, 2, refused.stdout);
    assert.equal(decode(refused.stdout).code, "finding-not-upheld");
  });
}

test("resume re-verifies only unverified candidates of a completed run and reruns only failed finders", (t) => {
  const f = queueFixture(t);
  const aspects = [ASPECT, "masked-errors"];
  f.setPlan({
    workers: {
      [ASPECT]: {
        ...found("findings", [
          candidate("source.ts", "// redundant", 1),
          candidate("source.ts", "export const value = 1;", 2),
        ]),
        verifier: {
          result: {
            aspect: ASPECT,
            status: "verdicts",
            verdicts: [
              {
                candidate: 1,
                verdict: "upheld",
                reason: "The source confirms the candidate.",
                action: "Remove it.",
              },
            ],
            limitations: ["The second candidate could not be checked."],
          },
        },
      },
      "masked-errors": {
        error: { message: "Cannot decode provider response" },
      },
    },
  });
  f.start(["--aspects", aspects.join(",")]);
  const done = f.finish();
  assert.equal(done.status, 1, done.stdout);
  const old = f.state();
  const [kept, failed] = aspects.map((aspect) =>
    old.tasks.find((t) => t.assignment.aspect === aspect),
  );
  assert.equal(kept?.status, "findings");
  assert.deepEqual(
    kept?.result?.findings.map((x) => x.verdict),
    ["upheld", "unverified"],
  );
  assert.equal(failed?.status, "failed");
  assert.deepEqual(kept?.result?.limitations, [
    "Verifier: The second candidate could not be checked.",
    "Unverified findings (1): no valid verifier verdict yet.",
  ]);
  const before = f.events().length;
  f.setPlan();
  const resumed = f.run(["resume", old.id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const fresh = f.events().slice(before);
  assert.deepEqual(
    fresh.filter((e) => e.stage === "find").map((e) => e.aspect),
    ["masked-errors"],
  );
  assert.deepEqual(
    fresh
      .filter((e) => e.stage === "verify")
      .map((e) => [e.aspect, e.candidates?.map((c) => c.quote)]),
    [[ASPECT, ["export const value = 1;"]]],
  );
  const task = f.state().tasks.find((t) => t.assignment.aspect === ASPECT);
  assert.deepEqual(task?.result?.findings[0], kept?.result?.findings[0]);
  assert.equal(task?.result?.findings[1]?.verdict, "upheld");
  assert.deepEqual(task?.result?.limitations, []);
  assert.deepEqual(
    task?.attempts.slice(0, kept?.attempts.length),
    kept?.attempts,
  );
  assert.equal(f.state().status, "completed");
  const again = f.run(["resume", old.id, "--wait", "20"]);
  assert.equal(again.status, 0, again.stdout);
  assert.equal(f.events().length, fresh.length + before);
});

test("a run deadline is reported as its own local stop and a blocking resume reruns that aspect's finder", (t) => {
  const f = queueFixture(t, {
    concurrency: 1,
    limits: { workerTimeoutSeconds: 60, runTimeoutSeconds: 6 },
  });
  f.setPlan({ workers: { [ASPECT]: { hang: true } } });
  const { task } = review(f);
  const old = f.state();
  assert.equal(old.executions?.at(-1)?.stopReason, "deadline");
  assert.notEqual(task.status, "no-findings");
  assert.deepEqual(task.unresolved, { cause: "deadline" });
  const attempt = task.attempts.at(-1);
  assert.equal(attempt?.diagnostic?.stop, "run");
  assert.equal(attempt?.diagnostic?.code, undefined);
  const report = f.run(["report", old.id]);
  assert.match(report.stdout, /stopCause: deadline/);
  f.setPlan();
  const before = f.events().length;
  const resumed = f.run(["resume", old.id, "--deadline", "30"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.equal(f.state().executions?.at(-1)?.waitSeconds, null);
  assert.deepEqual(
    f
      .events()
      .slice(before)
      .map((e) => e.stage),
    ["find"],
  );
  const after = f.state().tasks[0];
  assert.equal(after?.status, "no-findings");
  assert.equal(after?.unresolved, undefined);
});

test("a finder stopped at its own time ceiling is not retried; an idle stop is", (t) => {
  const ceiling = queueFixture(t, {
    maxRetries: 3,
    limits: { workerTimeoutSeconds: 2, workerIdleSeconds: 60 },
  });
  ceiling.setPlan({ workers: { [ASPECT]: { hang: true } } });
  const stopped = review(ceiling).task;
  assert.equal(stopped.attempts.length, 1);
  assert.equal(stopped.attempts[0]?.failure, "timeout");
  assert.equal(stopped.attempts[0]?.diagnostic?.stop, "ceiling");
  assert.deepEqual(stopped.unresolved, { cause: "timeout" });

  const idle = queueFixture(t, {
    maxRetries: 1,
    limits: { workerTimeoutSeconds: 60, workerIdleSeconds: 1 },
  });
  idle.setPlan({ workers: { [ASPECT]: { hang: true } } });
  assert.deepEqual(
    review(idle).task.attempts.map((a) => a.diagnostic?.stop),
    ["idle", "idle"],
  );
});

test("a finder cleanup failure leaves the aspect incomplete", (t) => {
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
  assert.deepEqual(task.unresolved, { cause: "cleanup" });
});

test("an aspect is not applicable when its finder says so and no verifier starts", (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: found("not-applicable", [], { reason: "No comments here." }),
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(task.status, "not-applicable");
  assert.equal(task.result?.reason, "No comments here.");
  assert.deepEqual(stage(f, "verify"), []);
});

test("a rejected quote drops only that candidate, is recorded and does not keep the aspect open", (t) => {
  for (const [findings, status, verdicts] of [
    [[candidate("source.ts", "invented quote")], "no-findings", []],
    [
      [
        candidate("source.ts", "// redundant"),
        candidate("source.ts", "invented quote", 2),
      ],
      "findings",
      [["// redundant", "upheld"]],
    ],
  ] as const) {
    const f = queueFixture(t);
    f.setPlan({ workers: { [ASPECT]: found("findings", [...findings]) } });
    const { done, task } = review(f);
    assert.equal(done.status, 0, done.stdout);
    assert.equal(task.status, status);
    assert.deepEqual(
      task.result?.findings.map((x) => [x.quote, x.verdict]),
      verdicts,
    );
    assert.deepEqual(task.rejections, [
      { index: findings.length, reason: "quote-mismatch" },
    ]);
    assert.equal(stage(f, "verify").length, verdicts.length);
  }
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
