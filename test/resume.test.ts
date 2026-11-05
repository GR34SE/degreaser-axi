import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { alive, queueFixture, until } from "./queue-fixture.ts";

test("resume retains successes, supersedes incomplete evidence and records only fresh unresolved attempts", async (t) => {
  const f = queueFixture(t);
  const incomplete = {
    aspect: "A06",
    status: "incomplete",
    findings: [],
    limitations: ["One construct remains unexamined."],
  };
  f.setPlan({
    results: {
      A04: {
        aspect: "A04",
        status: "not-applicable",
        findings: [],
        limitations: [],
        reason: "No error handling.",
      },
      A06: incomplete,
    },
    workers: { A05: { result: "" } },
  });
  assert.equal(f.start(["--aspects", "A01,A04,A05,A06"]).status, 3);
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
    ["A01", "A04", "A05", "A05", "A06", "A06"],
  );
  assert.ok(
    current.tasks.every((task) => task.attempts.every((a) => a.endedAt)),
  );
  assert.deepEqual(current.tasks[3]?.attempts[0], old.tasks[3]?.attempts[0]);
  assert.equal(current.tasks[3]?.result?.status, "no-findings");
  assert.equal(new Set(f.events().map((e) => e.sessionId)).size, 6);
  for (const aspect of ["A05", "A06"]) {
    const events = f.events().filter((e) => e.aspect === aspect);
    assert.equal(events[0]?.prompt, events[1]?.prompt);
  }
});

test("profile failure after resume keeps prior known usage without attributing it to an unstarted session", (t) => {
  const f = queueFixture(t);
  f.setPlan({
    results: {
      A06: {
        aspect: "A06",
        status: "incomplete",
        findings: [],
        limitations: ["One construct remains."],
      },
    },
  });
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  const task = old.tasks[0];
  const attempt = task?.attempts[0];
  assert.ok(task && attempt);
  task.usage = { inputTokens: 17 };
  attempt.usage = task.usage;
  const directory = join(f.root, ".degreaser/runs", old.id);
  writeFileSync(join(directory, "run.json"), JSON.stringify(old));
  const inputPath = join(directory, "input/review.json");
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  input.config.limits.workerTimeoutSeconds = 1;
  writeFileSync(inputPath, JSON.stringify(input));
  f.setPlan({ profileDelayMs: 2000 });
  const result = f.run(["resume", old.id, "--wait", "20"]);
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(f.state().tasks[0]?.attempts[0], attempt);
  assert.equal(f.state().tasks[0]?.attempts[1]?.usage, null);
  assert.equal(f.events().length, 1);
});

test("completed resume is a read-only no-op, but actual changed source is refused first", async (t) => {
  const f = queueFixture(t);
  f.start(["--aspects", "A06"]);
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
  f.start(["--aspects", "A06"]);
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
  f.setPlan({ workers: { A06: { hang: true, descendant: true } } });
  f.start(["--aspects", "A04,A06,A07"]);
  await until(
    () => f.lifecycle().some((e) => e.type === "descendant"),
    "Old attempt has a real descendant",
  );
  const old = f.state();
  assert.ok(old.owner);
  const previousOwner = old.owner;
  const oldWorker = f.events().find((e) => e.aspect === "A06");
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
  f.setPlan({ worker: { resultGate: f.gate("replacement") } });
  const capture = async (child: ReturnType<typeof f.launch>) => {
    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    const [code] = await once(child, "close");
    return { code, stdout };
  };
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
      A06: {
        aspect: "A06",
        status: "incomplete",
        findings: [],
        limitations: ["An unresolved construct remains."],
      },
    },
  });
  f.start(["--aspects", "A04,A06"]);
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
