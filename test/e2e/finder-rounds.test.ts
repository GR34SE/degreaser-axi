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

const sorted = (paths: readonly string[] | undefined) =>
  [...(paths ?? [])].sort();

const round = (
  status: string,
  findings: object[],
  examinedPaths: string[],
  extra: object = {},
) => found(status, findings, { examinedPaths, ...extra });

const IDENTITIES = [
  { agent: "codex", model: "gpt-6-luna", verifier: { model: "gpt-6-sol" } },
  {
    agent: "claude",
    model: "claude-haiku-4-5-20251001",
    verifier: { model: "claude-haiku-4-5-20251001" },
  },
  {
    agent: "pi",
    model: "openai/gpt-6-luna",
    verifier: { model: "openai/gpt-6-sol" },
  },
  {
    agent: "cursor",
    model: "composer-2.5-fast",
    verifier: { model: "composer-2.5-fast" },
  },
] as const;

for (const identity of IDENTITIES)
  test(`a ${identity.agent} finder that accounts for part of the paths is continued in the same session until every assessed path is covered`, (t) => {
    const f = paddedFixture(t, identity);
    const usage = { inputTokens: 10, outputTokens: 2 };
    f.setPlan({
      workers: {
        [ASPECT]: {
          rounds: [
            {
              ...round(
                "findings",
                [candidate("a.ts", "export const a = 1;")],
                ["a.ts"],
              ),
              usage,
            },
            {
              ...round(
                "findings",
                [candidate("b.ts", "export const b = 2;")],
                ["b.ts"],
              ),
              usage,
            },
            { ...round("no-findings", [], ["source.ts"]), usage },
          ],
        },
      },
    });
    const { done, task } = review(f);
    assert.equal(done.status, 0, done.stdout);
    assert.equal(f.state().status, "completed");
    assert.equal(task.status, "findings");
    const [first] = stage(f, "find");
    const finders = f.events().filter((e) => e.sessionId === first?.sessionId);
    assert.deepEqual(
      finders.map((e) => [e.round ?? 0, sorted(e.paths)]),
      [
        [0, ["a.ts", "b.ts", "source.ts"]],
        [1, ["b.ts", "source.ts"]],
        [2, ["source.ts"]],
      ],
    );
    assert.equal(new Set(finders.map((e) => e.sessionId)).size, 1);
    assert.equal(new Set(finders.map((e) => e.pid)).size, 1);
    const attempts = task.attempts.filter((a) => a.stage === "find");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.failure, null);
    assert.equal(attempts[0]?.rounds, 3);
    assert.deepEqual(attempts[0]?.usage, { inputTokens: 30, outputTokens: 6 });
    assert.deepEqual(
      task.result?.findings.map((x) => [x.location.path, x.verdict]),
      [
        ["a.ts", "upheld"],
        ["b.ts", "upheld"],
      ],
    );
    assert.deepEqual(sorted(task.result?.examinedPaths), [
      "a.ts",
      "b.ts",
      "source.ts",
    ]);
    assert.doesNotMatch(
      task.result?.limitations.join(" ") ?? "",
      /left unexamined/,
    );
  });

test("a round without progress ends the session as a completed review that names the unexamined paths", (t) => {
  const f = paddedFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          round(
            "findings",
            [candidate("a.ts", "export const a = 1;")],
            ["a.ts"],
          ),
          round("incomplete", [], [], {
            limitations: ["Tool output was truncated."],
          }),
        ],
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(f.state().status, "completed");
  assert.equal(task.status, "findings");
  assert.equal(task.unresolved, undefined);
  assert.deepEqual(
    stage(f, "find").map((e) => e.round ?? 0),
    [0, 1],
  );
  assert.equal(task.attempts.filter((a) => a.stage === "find").length, 1);
  assert.deepEqual(task.result?.examinedPaths, ["a.ts"]);
  assert.match(
    task.result?.limitations.join(" ") ?? "",
    /2 of 3 assessed paths were left unexamined/,
  );
  assert.deepEqual(
    task.result?.findings.map((x) => x.verdict),
    ["upheld"],
  );
});

test("a ceiling stop after a valid round keeps that round's candidates as a completed review", (t) => {
  const f = paddedFixture(t, {
    limits: { workerTimeoutSeconds: 3, runTimeoutSeconds: 30 },
  });
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          round(
            "findings",
            [candidate("a.ts", "export const a = 1;")],
            ["a.ts"],
          ),
          { hang: true },
        ],
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(f.state().status, "completed");
  assert.equal(task.status, "findings");
  const attempts = task.attempts.filter((a) => a.stage === "find");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.failure, null);
  assert.deepEqual(
    task.result?.findings.map((x) => [x.location.path, x.verdict]),
    [["a.ts", "upheld"]],
  );
  assert.match(
    task.result?.limitations.join(" ") ?? "",
    /2 of 3 assessed paths were left unexamined/,
  );
  assert.match(JSON.stringify(task), /total time ceiling/);
});

test("a first round that reports incomplete without candidates or examined paths leaves the aspect incomplete and resumable", (t) => {
  const f = paddedFixture(t);
  f.setPlan({
    workers: { [ASPECT]: { rounds: [round("incomplete", [], [])] } },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 1, done.stdout);
  assert.equal(f.state().status, "partial");
  assert.equal(task.status, "incomplete");
  assert.equal(task.unresolved?.cause, "incomplete");
  assert.doesNotMatch(
    task.result?.limitations.join(" ") ?? "",
    /left unexamined/,
  );
  assert.equal(task.attempts.filter((a) => a.stage === "find").length, 1);

  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [round("no-findings", [], ["a.ts", "b.ts", "source.ts"])],
      },
    },
  });
  const resumed = f.run(["resume", f.state().id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.equal(f.state().status, "completed");
  assert.equal(f.state().tasks[0]?.status, "no-findings");
  assert.deepEqual(f.state().tasks[0]?.result?.limitations, []);
});

test("a first round that reports incomplete after examining a path stays a completed review with the limitation", (t) => {
  const f = paddedFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          round("incomplete", [], ["a.ts"]),
          round("incomplete", [], []),
        ],
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(f.state().status, "completed");
  assert.equal(task.status, "no-findings");
  assert.match(
    task.result?.limitations.join(" ") ?? "",
    /2 of 3 assessed paths were left unexamined/,
  );
});

test("a quota failure in a later round keeps earlier candidates but leaves the aspect incomplete and resumable", (t) => {
  const f = paddedFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          round(
            "findings",
            [candidate("a.ts", "export const a = 1;")],
            ["a.ts"],
          ),
          { error: { message: "Quota exhausted" } },
        ],
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 1, done.stdout);
  assert.equal(f.state().status, "partial");
  assert.equal(task.status, "incomplete");
  assert.equal(task.unresolved?.cause, "rate-limited");
  const [attempt] = task.attempts.filter((a) => a.stage === "find");
  assert.equal(attempt?.failure, "rate-limited");
  assert.equal(attempt?.diagnostic?.recovery, "wait-for-quota");
  assert.deepEqual(
    task.result?.findings.map((x) => x.location.path),
    ["a.ts"],
  );

  const beforeResume = f.events().length;
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [round("no-findings", [], ["b.ts", "source.ts"])],
      },
    },
  });
  const resumed = f.run(["resume", f.state().id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.equal(f.state().status, "completed");
  assert.deepEqual(
    f
      .events()
      .slice(beforeResume)
      .filter((event) => event.stage === "find")
      .map((event) => event.paths),
    [["b.ts", "source.ts"]],
  );
  const after = f.state().tasks[0];
  assert.equal(after?.status, "findings");
  assert.deepEqual(
    after?.result?.findings.map((x) => x.location.path),
    ["a.ts"],
  );
});

test("a resumed finder keeps the quote rejections and limitations of the coverage it continues", (t) => {
  const f = paddedFixture(t);
  const limitation = "a.ts was only partly readable.";
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          round(
            "findings",
            [
              candidate("a.ts", "export const a = 1;"),
              candidate("a.ts", "invented quote", 2),
              candidate("a.ts", "another invented quote", 3),
            ],
            ["a.ts"],
            { limitations: [limitation] },
          ),
          { error: { message: "Quota exhausted" } },
        ],
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 1, done.stdout);
  const rejected = [
    { index: 2, reason: "quote-mismatch" },
    { index: 3, reason: "quote-mismatch" },
  ];
  assert.deepEqual(task.rejections, rejected);

  f.setPlan({
    workers: {
      [ASPECT]: { rounds: [round("no-findings", [], ["b.ts", "source.ts"])] },
    },
  });
  const resumed = f.run(["resume", f.state().id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const after = f.state().tasks[0];
  assert.equal(after?.status, "findings");
  assert.deepEqual(after?.rejections, rejected);
  assert.deepEqual(after?.result?.limitations, [
    limitation,
    "2 candidate(s) were rejected by literal source validation.",
  ]);
  assert.match(resumed.stdout, /rejected: 2/);
});

test("a not-applicable first round ends the finder without following remaining paths", (t) => {
  const f = paddedFixture(t);
  f.write("source.ts", "export const source = 1;\n");
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          round("not-applicable", [], ["a.ts"], {
            reason:
              "No explanatory comments or docstrings exist in the assessed paths.",
          }),
          round("no-findings", [], ["b.ts", "source.ts"]),
        ],
      },
    },
  });
  const { done, task } = review(f);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(task.status, "not-applicable");
  assert.match(task.result?.reason ?? "", /No explanatory comments/);
  assert.equal(stage(f, "find").length, 1);
  assert.equal(task.attempts[0]?.rounds, 1);
  assert.equal(stage(f, "verify").length, 0);
});
