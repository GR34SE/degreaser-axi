import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ASPECT, candidate, found, stage } from "../utils/coverage-fixture.ts";
import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

function candidates(
  f: ReturnType<typeof queueFixture>,
  count: number,
  path = "source.ts",
) {
  const lines = Array.from(
    { length: count },
    (_, i) => `// repeated explanation ${i + 1}`,
  );
  f.write(path, `${lines.join("\n")}\nexport const value = 1;\n`);
  return lines.map((quote, i) => candidate(path, quote, i + 1));
}

test("five quote-checked candidates are verified while their finder continues in the same session", async (t) => {
  const f = queueFixture(t, {
    limits: { workerTimeoutSeconds: 30, runTimeoutSeconds: 60 },
  });
  const proposed = candidates(f, 5, "a.ts");
  f.write("b.ts", "export const other = 1;\n");
  f.setPlan({
    workers: {
      [ASPECT]: {
        rounds: [
          found("findings", proposed, { examinedPaths: ["a.ts"] }),
          {
            ...found("no-findings", [], {
              examinedPaths: ["b.ts", "source.ts"],
            }),
            resultGate: f.gate("finish-finder"),
          },
        ],
      },
    },
  });
  f.start(["--aspects", ASPECT]);
  await until(
    () => stage(f, "verify").length === 1,
    "The first verifier batch starts before the finder finishes",
    4000,
  );
  const running = f.state().tasks[0];
  assert.equal(
    running?.attempts.find((attempt) => attempt.stage === "find")?.endedAt,
    null,
  );
  assert.equal(stage(f, "verify")[0]?.candidates?.length, 5);
  await until(
    () =>
      f
        .state()
        .tasks[0]?.result?.findings.every(
          (finding) => finding.verdict === "upheld",
        ) === true,
    "Verdicts are persisted while the finder is still gated",
  );
  assert.equal(f.state().tasks[0]?.status, "running");
  f.release("finish-finder");
  const done = f.finish();
  assert.equal(done.status, 0, done.stdout);
  const task = f.state().tasks[0];
  assert.equal(
    task?.attempts.filter((attempt) => attempt.stage === "find").length,
    1,
  );
  assert.equal(task?.result?.findings.length, 5);
  assert.ok(
    (task?.attempts.find((attempt) => attempt.stage === "verify")?.startedAt ??
      Infinity) <
      (task?.attempts.find((attempt) => attempt.stage === "find")?.endedAt ??
        0),
  );
});

test("verifier batches never exceed ten candidates and the final short batch is not lost", (t) => {
  const f = queueFixture(t);
  f.setPlan({ workers: { [ASPECT]: found("findings", candidates(f, 23)) } });
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
  assert.deepEqual(
    stage(f, "verify").map((event) => event.candidates?.length),
    [10, 10, 3],
  );
  const findings = f.state().tasks[0]?.result?.findings ?? [];
  assert.equal(findings.length, 23);
  assert.ok(findings.every((finding) => finding.verdict === "upheld"));
});

test("a timed-out verifier retains valid verdicts and retries only its remaining candidates once in a smaller batch", (t) => {
  const f = queueFixture(t, {
    limits: { workerTimeoutSeconds: 3, runTimeoutSeconds: 30 },
  });
  f.setPlan({
    workers: {
      [ASPECT]: {
        ...found("findings", candidates(f, 4)),
        verifier: {
          attempts: [
            {
              verdicts: ["upheld", "refuted", "omit", "omit"],
              afterHang: true,
            },
            {},
          ],
        },
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
    f.state().tasks[0]?.result?.findings.map((finding) => finding.verdict),
    ["upheld", "refuted", "upheld", "upheld"],
  );
  assert.deepEqual(
    stage(f, "verify").map((event) =>
      event.candidates?.map((candidate) => candidate.quote),
    ),
    [
      [
        "// repeated explanation 1",
        "// repeated explanation 2",
        "// repeated explanation 3",
        "// repeated explanation 4",
      ],
      ["// repeated explanation 3", "// repeated explanation 4"],
    ],
  );
  assert.equal(stage(f, "find").length, 1);
  assert.equal(
    f.state().tasks[0]?.attempts.find((attempt) => attempt.stage === "verify")
      ?.failure,
    "timeout",
  );
});

test("resume after an aspect error outside a finished finder keeps its evidence and verifies only the open candidate", async (t) => {
  const f = queueFixture(t);
  f.setPlan({
    workers: {
      [ASPECT]: {
        ...found("findings", candidates(f, 2)),
        verifier: {
          attempts: [{ verdicts: ["upheld", "omit"] }, { verdicts: ["omit"] }],
        },
      },
    },
  });
  f.start(["--aspects", ASPECT]);
  assert.equal(f.finish().status, 0);
  const saved = f.state();
  const owner = saved.owner;
  assert.ok(owner);
  await until(() => !alive(owner.pid), "First owner exits");
  const [task] = saved.tasks;
  assert.ok(task?.result);
  assert.deepEqual(
    task.result.findings.map((finding) => finding.verdict),
    ["upheld", "unverified"],
  );
  const failure =
    "Aspect failed (owner-failed): Error: Synthetic verifier fault";
  task.status = "incomplete";
  task.unresolved = { cause: "owner-failed" };
  task.result.status = "incomplete";
  task.result.limitations.push(failure);
  task.limitations.push(failure);
  saved.status = "partial";
  writeFileSync(
    join(f.root, ".degreaser/runs", saved.id, "run.json"),
    JSON.stringify(saved),
  );
  const before = f.events().length;
  f.setPlan();
  const resumed = f.run(["resume", saved.id, "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  assert.deepEqual(
    f
      .events()
      .slice(before)
      .map((event) => [event.stage, event.candidates?.map((c) => c.quote)]),
    [["verify", ["// repeated explanation 2"]]],
  );
  const current = f.state();
  const after = current.tasks[0];
  assert.equal(current.status, "completed");
  assert.equal(after?.status, "findings");
  assert.equal(after?.unresolved, undefined);
  assert.deepEqual(after?.result?.findings[0], task.result.findings[0]);
  assert.equal(after?.result?.findings[1]?.verdict, "upheld");
  assert.deepEqual(after?.result?.examinedPaths, task.result.examinedPaths);
  assert.deepEqual(
    after?.attempts.slice(0, task.attempts.length),
    task.attempts,
  );
});
