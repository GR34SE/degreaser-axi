import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { alive, capture, queueFixture, until } from "./queue-fixture.ts";

const { decode } = createRequire(import.meta.resolve("axi-sdk-js"))(
  "@toon-format/toon",
);

test("resume retains successes, supersedes incomplete evidence and records only fresh unresolved attempts", async (t) => {
  const f = queueFixture(t);
  const incomplete = {
    aspect: "low-value-comments",
    status: "incomplete",
    findings: [],
    limitations: ["One construct remains unexamined."],
  };
  f.setPlan({
    results: {
      "masked-errors": {
        aspect: "masked-errors",
        status: "not-applicable",
        findings: [],
        limitations: [],
        reason: "No error handling.",
      },
      "low-value-comments": incomplete,
    },
    workers: { "unjustified-defense": { result: "" } },
  });
  assert.equal(
    f.start([
      "--aspects",
      "missed-reuse,masked-errors,unjustified-defense,low-value-comments",
    ]).status,
    3,
  );
  assert.equal(f.finish().status, 1);
  const old = f.state();
  const successful = old.tasks[0];
  assert.ok(successful);
  successful.usage = { inputTokens: 29 };
  // Synthetic persisted metadata, independent of the transport fixture's unknown usage.
  writeFileSync(
    join(f.root, ".degreaser/runs", old.id, "run.json"),
    JSON.stringify(old),
  );
  f.setPlan();
  const result = f.run([
    "resume",
    old.id,
    "--wait",
    "20",
    "--concurrency",
    "1",
  ]);
  assert.equal(result.status, 0, result.stdout);
  const current = f.state();
  assert.equal(current.id, old.id);
  assert.equal(current.identity, old.identity);
  assert.equal(current.deadline, old.deadline);
  assert.deepEqual(current.tasks.slice(0, 2), old.tasks.slice(0, 2));
  assert.deepEqual(
    f
      .events()
      .map((e) => e.aspect)
      .sort(),
    [
      "low-value-comments",
      "low-value-comments",
      "masked-errors",
      "missed-reuse",
      "unjustified-defense",
      "unjustified-defense",
    ],
  );
  assert.ok(
    current.tasks.every((task) => task.attempts.every((a) => a.endedAt)),
  );
  assert.deepEqual(current.tasks[3]?.attempts[0], old.tasks[3]?.attempts[0]);
  assert.equal(current.tasks[3]?.result?.status, "no-findings");
  assert.equal(new Set(f.events().map((e) => e.sessionId)).size, 6);
  const retried = f.events().filter((e) => e.aspect === "unjustified-defense");
  assert.equal(retried[0]?.prompt, retried[1]?.prompt);
});

test("resumed pre-result failure reports unknown latest usage while retaining distinct attempt metadata and peer evidence", async (t) => {
  const f = queueFixture(t);
  // Synthetic adapter metadata, not measured usage from a live provider.
  const priorUsage = { inputTokens: 17, outputTokens: 3, totalTokens: 20 };
  const peerUsage = { inputTokens: 29, outputTokens: 5, totalTokens: 34 };
  const nextUsage = { inputTokens: 41, outputTokens: 7, totalTokens: 48 };
  const evidence = {
    location: {
      path: "source.ts",
      side: "new",
      startLine: 1,
      endLine: 1,
    },
    quote: "// redundant",
    title: "Redundant comment",
    evidence: "The comment repeats the following constant.",
    consequence: "Extra text to maintain.",
    countercheck: "The comment explains no constraint.",
    recommendation: "Remove the redundant comment.",
  };
  f.setPlan({
    workers: {
      "masked-errors": { usage: peerUsage },
      "low-value-comments": { usage: priorUsage },
    },
    results: {
      "low-value-comments": {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [evidence],
        limitations: ["One construct remains."],
      },
    },
  });
  f.start(["--aspects", "masked-errors,low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  assert.equal(old.status, "partial");
  assert.deepEqual(old.tasks[0]?.usage, peerUsage);
  assert.deepEqual(old.tasks[1]?.usage, priorUsage);
  assert.deepEqual(old.tasks[1]?.attempts[0]?.usage, priorUsage);
  const originalDetail = decode(
    f.run(["finding", "F1", "--run", old.id]).stdout,
  );
  const owner = old.owner;
  if (owner) await until(() => !alive(owner.pid), "Initial owner exits");
  const directory = join(f.root, ".degreaser/runs", old.id);
  const inputPath = join(directory, "input/review.json");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  input.config.limits.workerTimeoutSeconds = 4;
  writeFileSync(inputPath, JSON.stringify(input));
  f.setPlan({ profileDelayMs: 6000 });
  const resumed = f.run(["resume", old.id, "--wait", "1"]);
  assert.equal(resumed.status, 3, resumed.stdout);
  const running = f.state();
  assert.equal(f.finish().status, 1);
  const failed = f.state();
  assert.equal(failed.id, old.id);
  assert.equal(failed.status, "partial");
  assert.deepEqual(failed.tasks[0], old.tasks[0]);
  assert.deepEqual(failed.tasks[1]?.result, old.tasks[1]?.result);
  assert.deepEqual(failed.tasks[1]?.attempts[0], old.tasks[1]?.attempts[0]);
  assert.equal(failed.tasks[1]?.usage, null);
  assert.equal(failed.tasks[1]?.attempts[1]?.usage, null);
  assert.equal(failed.tasks[1]?.attempts[1]?.sessionId, null);
  assert.equal(failed.tasks[1]?.attempts[1]?.failure, "timeout");
  assert.equal(running.tasks[1]?.attempts.length, 2);
  assert.equal(running.tasks[1]?.usage, null);
  assert.equal(decode(resumed.stdout).usage, "unknown");
  assert.equal(f.events().length, 2);
  const short = f.run(["report", old.id]);
  assert.equal(short.status, 1);
  assert.equal(decode(short.stdout).usage, "unknown");
  const full = f.run(["report", old.id, "--full"]);
  assert.equal(full.status, 1);
  assert.equal(full.stderr, "");
  const report = decode(full.stdout);
  assert.equal(report.usageScope, "latest-attempt-per-aspect");
  assert.equal(report.usage, "unknown");
  assert.deepEqual(report.execution[0].usage, peerUsage);
  assert.equal(report.execution[1].usage, "unknown");
  assert.deepEqual(
    report.execution[1].attempts.map(
      (attempt: { usage: unknown }) => attempt.usage,
    ),
    [priorUsage, null],
  );
  assert.equal(f.run(["report", old.id, "--full"]).stdout, full.stdout);
  const detail = decode(f.run(["finding", "F1", "--run", old.id]).stdout);
  for (const key of ["id", "group", "quote", "evidence", "location"])
    assert.deepEqual(detail[key], originalDetail[key]);
  assert.equal(detail.aspectStatus, "incomplete");
  assert.ok(detail.limitations.includes("One construct remains."));

  f.setPlan({ workers: { "low-value-comments": { usage: nextUsage } } });
  const completed = f.run(["resume", old.id, "--wait", "20"]);
  assert.equal(completed.status, 0, completed.stdout);
  const current = f.state();
  assert.equal(current.id, old.id);
  assert.deepEqual(current.tasks[0], old.tasks[0]);
  assert.deepEqual(
    current.tasks[1]?.attempts.slice(0, 2),
    failed.tasks[1]?.attempts,
  );
  assert.deepEqual(current.tasks[1]?.usage, nextUsage);
  const final = decode(f.run(["report", old.id, "--full"]).stdout);
  assert.equal(final.usageScope, "latest-attempt-per-aspect");
  assert.deepEqual(final.usage, [
    { aspect: "masked-errors", ...peerUsage },
    { aspect: "low-value-comments", ...nextUsage },
  ]);
  assert.deepEqual(
    final.execution[1].attempts.map(
      (attempt: { usage: unknown }) => attempt.usage,
    ),
    [priorUsage, null, nextUsage],
  );
  assert.deepEqual(
    f
      .events()
      .map((event) => event.aspect)
      .sort(),
    ["low-value-comments", "low-value-comments", "masked-errors"],
  );
});

test("completed resume is a read-only no-op, but actual changed source is refused first", async (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  const before = readFileSync(path);
  for (let i = 0; i < 2; i++) {
    const result = f.run(["resume", run.id]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /status: already-completed/);
    assert.ok(result.stdout.includes(`report ${run.id}`));
    assert.deepEqual(readFileSync(path), before);
  }
  f.write("source.ts", "export const value = 2;\n");
  const changed = f.run(["resume", run.id]);
  assert.equal(changed.status, 2, changed.stdout);
  assert.match(changed.stdout, /input-changed/);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(f.events().length, 1);
});

test("persisted wait and concurrency are not review identity and resume does not silently renew an expired deadline", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  const directory = join(f.root, ".degreaser/runs", old.id);
  const path = join(directory, "input/review.json");
  const input = JSON.parse(readFileSync(path, "utf8"));
  input.waitSeconds = 2;
  input.config.concurrency = 1;
  writeFileSync(path, JSON.stringify(input));
  const expired = { ...old, deadline: Date.now() - 1000 };
  writeFileSync(join(directory, "run.json"), JSON.stringify(expired));
  const denied = f.run(["resume", old.id]);
  assert.equal(denied.status, 2, denied.stdout);
  assert.match(denied.stdout, /deadline-expired/);
  assert.ok(denied.stdout.includes(`resume ${old.id} --deadline`));
  assert.deepEqual(f.state(), expired);
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  const before = Date.now();
  const resumed = f.run([
    "resume",
    old.id,
    "--deadline",
    "20",
    "--wait",
    "1",
    "--concurrency",
    "2",
  ]);
  assert.equal(resumed.status, 3, resumed.stdout);
  assert.equal(f.state().identity, old.identity);
  assert.ok(f.state().deadline >= before + 20_000);
  assert.equal(
    f.state().deadline,
    (f.state().executions?.at(-1)?.startedAt ?? 0) + 20_000,
  );
  assert.deepEqual(f.state().executions?.slice(0, -1), old.executions);
  f.release("finish");
  assert.equal(f.finish().status, 0);
});

test("a killed owner exposes interrupted and racing resumes admit only one nonoverlapping replacement", async (t) => {
  const f = queueFixture(t, { concurrency: 1 });
  f.setPlan({
    workers: { "convention-drift": { hang: true, descendant: true } },
  });
  f.start(["--aspects", "masked-errors,convention-drift,low-value-comments"]);
  await until(
    () => f.lifecycle().some((e) => e.type === "descendant"),
    "Old attempt has a real descendant",
  );
  const old = f.state();
  assert.ok(old.owner);
  const previousOwner = old.owner;
  const oldWorker = f.events().find((e) => e.aspect === "convention-drift");
  assert.equal(old.tasks[1]?.attempts[0]?.sessionId, oldWorker?.sessionId);
  // Cleanup on a red run owns exactly this detached fixture process group.
  t.after(() => {
    try {
      process.kill(-previousOwner.pid, "SIGKILL");
    } catch {}
  });
  await until(
    () => (f.state().owner?.heartbeat ?? 0) > previousOwner.heartbeat,
    "Heartbeat records live work",
  );
  const oldProcesses = f
    .lifecycle()
    .flatMap((e) => [e.pid, ...(e.childPid ? [e.childPid] : [])]);
  process.kill(previousOwner.pid, "SIGKILL");
  await until(() => !alive(previousOwner.pid), "Owner is dead");
  const report = f.run(["report", old.id]);
  assert.equal(report.status, 1, report.stdout);
  assert.match(report.stdout, /status: interrupted/);
  assert.ok(report.stdout.includes(`resume ${old.id}`));
  const persisted = readFileSync(
    join(f.root, ".degreaser/runs", old.id, "run.json"),
  );
  for (const args of [[], ["--full"]]) {
    const output = decode(f.run(["report", old.id, ...args]).stdout);
    assert.deepEqual(
      output.coverage.map((row: { status: string }) => row.status),
      ["no-findings", "interrupted", "pending"],
    );
    assert.match(output.coverage[1].reason, /last persisted.*running/i);
    if (args.length) {
      assert.equal(output.execution[1].attemptStatusBasis, "last-persisted");
      assert.deepEqual(
        output.execution[1].attempts,
        f.state().tasks[1]?.attempts,
      );
    }
  }
  assert.deepEqual(
    readFileSync(join(f.root, ".degreaser/runs", old.id, "run.json")),
    persisted,
  );
  f.setPlan({ worker: { resultGate: f.gate("replacement") } });

  const results = await Promise.all(
    [1, 2].map(() => capture(f.launch(["resume", old.id, "--wait", "1"]))),
  );
  assert.deepEqual(
    results.map((r) => r.code).sort(),
    [2, 3],
    JSON.stringify(results),
  );
  assert.match(results.find((r) => r.code === 2)?.stdout ?? "", /run-busy/);
  assert.ok(oldProcesses.every((pid) => !alive(pid)));
  const run = f.state();
  assert.deepEqual(run.tasks[0], old.tasks[0]);
  f.release("replacement");
  assert.equal(f.finish().status, 0);
  assert.deepEqual(
    f.state().tasks.map((t) => t.attempts.length),
    [1, 2, 1],
  );
  const attempts = f.state().tasks[1]?.attempts;
  assert.equal(attempts?.[0]?.failure, "interrupted");
  assert.ok(
    (attempts?.[0]?.endedAt ?? Infinity) <= (attempts?.[1]?.startedAt ?? 0),
  );
  assert.ok(
    !existsSync(join(f.root, ".degreaser/runs", old.id, "admission.lock")),
  );
});

test("an unsuccessful continuation retains prior incomplete evidence and retries without renewing its explicit budget", (t) => {
  const f = queueFixture(t, { maxRetries: 1 });
  f.setPlan({
    results: {
      "low-value-comments": {
        aspect: "low-value-comments",
        status: "incomplete",
        findings: [],
        limitations: ["An unresolved construct remains."],
      },
    },
  });
  f.start(["--aspects", "masked-errors,low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  f.setPlan({ worker: { result: "" } });
  const result = f.run(["resume", old.id, "--deadline", "20", "--wait", "20"]);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /status: partial/);
  const current = f.state();
  assert.deepEqual(current.tasks[0], old.tasks[0]);
  assert.deepEqual(current.tasks[1]?.result, old.tasks[1]?.result);
  assert.deepEqual(current.tasks[1]?.attempts[0], old.tasks[1]?.attempts[0]);
  assert.equal(current.tasks[1]?.attempts.length, 3);
  assert.equal(
    current.deadline,
    (current.executions?.at(-1)?.startedAt ?? 0) + 20_000,
  );
});
