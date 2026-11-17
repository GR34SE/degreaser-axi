import assert from "node:assert/strict";
import test from "node:test";
import { capture, queueFixture, until } from "../utils/queue-fixture.ts";

test("two simultaneous reviews of the same repository finish independently with separate evidence", async (t) => {
  const f = queueFixture(t);
  f.setPlan({
    worker: {
      resultGate: f.gate("both-ready"),
      result: {
        aspect: "low-value-comments",
        status: "findings",
        examinedPaths: ["source.ts"],
        limitations: [],
        findings: [
          {
            location: {
              path: "source.ts",
              side: "new",
              startLine: 1,
              endLine: 1,
            },
            quote: "// redundant",
            title: "Repeats the declaration",
          },
        ],
      },
    },
  });
  const args = [
    "review",
    "--scope",
    "worktree",
    "--task",
    "Update source",
    "--aspects",
    "low-value-comments",
  ];
  const first = capture(f.launch(args));
  const second = capture(f.launch(args));
  await until(
    () => f.events().length === 2,
    "Both reviews have an active finder",
  );
  assert.equal(new Set(f.events().map((event) => event.pid)).size, 2);
  f.release("both-ready");
  const responses = await Promise.all([first, second]);
  const ids = responses.map((response) => {
    assert.equal(response.code, 0, response.stdout + response.stderr);
    const id = /run: (r-\d{8}-\d{4}-[a-f0-9]{4})/.exec(response.stdout)?.[1];
    assert.ok(id);
    return id;
  });
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) {
    const run = f.state(id);
    assert.equal(run.status, "completed");
    assert.equal(run.tasks[0]?.result?.findings[0]?.verdict, "upheld");
    assert.deepEqual(
      run.tasks[0]?.attempts.map((attempt) => attempt.stage),
      ["find", "verify"],
    );
    assert.equal(f.run(["export", id]).status, 0);
  }
});
