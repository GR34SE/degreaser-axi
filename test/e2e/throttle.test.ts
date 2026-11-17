import assert from "node:assert/strict";
import test from "node:test";
import { ASPECT, candidate, found, stage } from "../utils/coverage-fixture.ts";
import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

const throttled = {
  error: {
    message: "Rate limit temporarily exceeded; retry after a short delay.",
  },
};
for (const recovers of [true, false])
  test(`temporary throttling halves the live session cap and retries once${recovers ? " successfully" : " without looping"}`, async (t) => {
    const f = queueFixture(t, { concurrency: 4, maxRetries: 3 });
    f.setPlan({
      worker: { resultGate: f.gate("peers") },
      workers: {
        [ASPECT]: { attempts: [throttled, recovers ? {} : throttled, {}] },
      },
    });
    f.start([
      "--aspects",
      `masked-errors,verification-theater,contract-bypass,${ASPECT}`,
    ]);
    await until(
      () => f.state().executions?.at(-1)?.concurrency === 2,
      "Temporary throttling reduces the actual run cap",
      4000,
    );
    const task = f
      .state()
      .tasks.find((task) => task.assignment.aspect === ASPECT);
    const failed = task?.attempts[0];
    const endedAt = failed?.endedAt;
    assert.ok(endedAt);
    await until(
      () => Date.now() - endedAt >= 2200,
      "The bounded backoff elapsed while three peers remain active",
      5000,
    );
    assert.equal(
      stage(f, "find").filter((event) => event.aspect === ASPECT).length,
      1,
      "The retry cannot start above the halved cap",
    );
    f.release("peers");
    const done = f.finish();
    assert.equal(done.status, recovers ? 0 : 1, done.stdout);
    const after = f.state();
    assert.equal(after.status, recovers ? "completed" : "partial");
    const attempts =
      after.tasks.find((task) => task.assignment.aspect === ASPECT)?.attempts ??
      [];
    assert.equal(attempts.length, 2);
    assert.ok(attempts[1] && attempts[1].startedAt - endedAt >= 2000);
    assert.equal(after.executions?.at(-1)?.concurrency, 2);
    for (const peer of after.tasks.filter(
      (task) => task.assignment.aspect !== ASPECT,
    )) {
      assert.equal(peer.status, "no-findings");
      assert.equal(peer.attempts.length, 1);
    }
    assert.ok(
      f
        .events()
        .every(
          (event) => event.agent === "codex" && event.model === "gpt-6-luna",
        ),
    );
  });

test("a temporarily throttled later round recovers automatically from its saved finder coverage", (t) => {
  const f = queueFixture(t, { maxRetries: 1 });
  const limitation = "a.ts was only partly readable.";
  f.write("a.ts", "export const a = 1;\n");
  f.setPlan({
    workers: {
      [ASPECT]: {
        attempts: [
          {
            rounds: [
              found("findings", [candidate("a.ts", "export const a = 1;")], {
                examinedPaths: ["a.ts"],
                limitations: [limitation],
              }),
              throttled,
            ],
          },
          found("no-findings", [], { examinedPaths: ["source.ts"] }),
        ],
      },
    },
  });
  const done = f.run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--aspects",
    ASPECT,
  ]);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(f.state().status, "completed");
  assert.deepEqual(
    stage(f, "find").map((event) => event.paths),
    [["a.ts", "source.ts"], ["source.ts"], ["source.ts"]],
  );
  assert.equal(f.state().tasks[0]?.result?.findings[0]?.verdict, "upheld");
  assert.deepEqual(f.state().tasks[0]?.result?.limitations, [limitation]);
  assert.equal(
    new Set(stage(f, "find").map((event) => event.sessionId)).size,
    2,
  );
});

test("temporary verifier throttling retries the missing candidates in smaller batches with the same model", (t) => {
  const f = queueFixture(t);
  f.write("source.ts", "// one\n// two\n// three\n// four\n");
  f.setPlan({
    workers: {
      [ASPECT]: {
        ...found(
          "findings",
          ["// one", "// two", "// three", "// four"].map((quote, i) =>
            candidate("source.ts", quote, i + 1),
          ),
        ),
        verifier: { attempts: [throttled, {}, {}] },
      },
    },
  });
  const done = f.run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--aspects",
    ASPECT,
  ]);
  assert.equal(done.status, 0, done.stdout);
  assert.equal(f.state().status, "completed");
  assert.deepEqual(
    stage(f, "verify").map((event) => event.candidates?.length),
    [4, 2, 2],
  );
  assert.ok(
    f
      .state()
      .tasks[0]?.result?.findings.every(
        (finding) => finding.verdict === "upheld",
      ),
  );
  assert.equal(f.state().executions?.at(-1)?.concurrency, 1);
  assert.ok(stage(f, "verify").every((event) => event.model === "gpt-6-sol"));
});

const SOLE = {
  "under a wider RC cap": "none",
  "beside an aspect the coordinator resolved": "coordinator",
  "beside a peer resolved before the resume": "resumed",
} as const;
for (const [situation, idle] of Object.entries(SOLE))
  test(`a throttled verifier of the only working aspect ${situation} retries only after its finder frees the halved session capacity`, async (t) => {
    const f = queueFixture(t, {
      ...(idle === "none" ? { concurrency: 16 } : {}),
      limits: { workerTimeoutSeconds: 30, runTimeoutSeconds: 60 },
    });
    const quotes = Array.from({ length: 5 }, (_, i) => `// note ${i + 1}`);
    f.write("a.ts", `${quotes.join("\n")}\nexport const a = 1;\n`);
    if (idle === "resumed") {
      f.setPlan({
        workers: {
          [ASPECT]: { error: { message: "Cannot decode provider response" } },
        },
      });
      f.start(["--aspects", `masked-errors,${ASPECT}`]);
      assert.equal(f.finish().status, 1);
      const owner = f.state().owner;
      if (owner) await until(() => !alive(owner.pid), "First owner exits");
    }
    const before = f.events().length;
    const since = (name: "find" | "verify") =>
      f
        .events()
        .slice(before)
        .filter((event) => event.stage === name);
    const working = () =>
      f.state().tasks.find((task) => task.assignment.aspect === ASPECT);
    f.setPlan({
      workers: {
        [ASPECT]: {
          rounds: [
            found(
              "findings",
              quotes.map((quote, i) => candidate("a.ts", quote, i + 1)),
              { examinedPaths: ["a.ts"] },
            ),
            { ...found("no-findings"), resultGate: f.gate("finder") },
          ],
          verifier: { attempts: [throttled] },
        },
      },
    });
    if (idle === "resumed") f.run(["resume", f.state().id, "--wait", "1"]);
    else if (idle === "coordinator")
      f.run([
        "review",
        "--scope",
        "repository",
        "--task",
        "Audit source",
        "--wait",
        "1",
        "--aspects",
        `scope-creep,${ASPECT}`,
      ]);
    else f.start(["--aspects", ASPECT]);
    await until(
      () => f.state().executions?.at(-1)?.concurrency === 1,
      "One finder and one verifier are the whole fleet, so its half is one session",
      6000,
    );
    const endedAt = working()?.attempts.find(
      (attempt) => attempt.stage === "verify",
    )?.endedAt;
    assert.ok(endedAt);
    await until(
      () => Date.now() - endedAt >= 2200,
      "The bounded backoff elapsed while the finder is still gated",
      5000,
    );
    assert.equal(
      working()?.attempts.findLast((attempt) => attempt.stage === "find")
        ?.endedAt,
      null,
    );
    assert.equal(
      since("verify").length,
      1,
      "The retry cannot start while the finder holds the only session",
    );
    f.release("finder");
    const done = f.finish();
    assert.equal(done.status, 0, done.stdout);
    assert.equal(f.state().status, "completed");
    assert.deepEqual(
      since("verify").map((event) => event.candidates?.length),
      [5, 2, 2, 1],
    );
    assert.deepEqual(
      working()?.result?.findings.map((finding) => finding.verdict),
      Array(5).fill("upheld"),
    );
    assert.equal(since("find").length, 2);
    assert.ok(since("find").every((event) => event.model === "gpt-6-luna"));
    assert.ok(since("verify").every((event) => event.model === "gpt-6-sol"));
    assert.ok(f.events().every((event) => event.agent === "codex"));
  });
