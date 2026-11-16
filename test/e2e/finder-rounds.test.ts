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
