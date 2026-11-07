import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { alive, queueFixture, until } from "./queue-fixture.ts";

test("a live stopped owner cannot be evicted by stale heartbeat, and PID or lock ambiguity never signals an unrelated process", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("finish") } });
  f.start(["--aspects", "low-value-comments"]);
  const run = f.state();
  assert.ok(run.owner);
  const owner = run.owner;
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  process.kill(owner.pid, "SIGSTOP");
  try {
    const stale = { ...run, owner: { ...owner, heartbeat: 0 } };
    writeFileSync(path, JSON.stringify(stale));
    const bytes = readFileSync(path);
    const result = f.run(["resume", run.id, "--wait", "1"]);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /run-busy/);
    assert.equal(f.run(["report", run.id]).status, 3);
    assert.deepEqual(readFileSync(path), bytes);
    assert.ok(alive(owner.pid));
    assert.equal(f.events().length, 1);
  } finally {
    writeFileSync(path, JSON.stringify(run));
    process.kill(owner.pid, "SIGCONT");
  }
  f.release("finish");
  assert.equal(f.finish().status, 0);
  await until(() => !alive(owner.pid), "Original owner exits");
  const complete = f.state();
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  assert.ok(sentinel.pid);
  try {
    const ambiguous = {
      ...complete,
      status: "running",
      owner: { pid: sentinel.pid, heartbeat: 0, started: owner.started },
    };
    writeFileSync(path, JSON.stringify(ambiguous));
    const bytes = readFileSync(path);
    const report = f.run(["report", run.id]);
    assert.equal(report.status, 1, report.stdout);
    assert.match(report.stdout, /status: interrupted/);
    assert.match(report.stdout, /[Ii]nspect.*(PID|pid|ownership)/);
    assert.ok(!report.stdout.includes(`degreaser-axi resume ${run.id}`));
    const result = f.run(["resume", run.id]);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /owner-unverified/);
    assert.match(result.stdout, /same Node executable/);
    assert.match(result.stdout, /new review.*old work.*stopped/);
    assert.deepEqual(readFileSync(path), bytes);
    assert.ok(alive(sentinel.pid));
  } finally {
    writeFileSync(path, JSON.stringify(complete));
    const closed = once(sentinel, "close");
    sentinel.kill("SIGKILL");
    await closed;
  }
});

test("ambiguous stale locks refuse takeover without replacing history", (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const run = f.state();
  const directory = join(f.root, ".degreaser/runs", run.id);
  const before = readFileSync(join(directory, "run.json"));
  writeFileSync(join(directory, "owner.lock"), "{}");
  const result = f.run(["resume", run.id]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /owner-unverified/);
  assert.deepEqual(readFileSync(join(directory, "run.json")), before);
  assert.equal(readFileSync(join(directory, "owner.lock"), "utf8"), "{}");
  assert.equal(f.events().length, 1);
});

test("a reused child PID gets inspection guidance without signalling it or rewriting history", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { result: "" } });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const run = f.state(),
    owner = run.owner;
  assert.ok(owner);
  await until(() => !alive(owner.pid), "Original owner exits");
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    detached: true,
    stdio: "ignore",
  });
  const exited = once(sentinel, "exit");
  assert.ok(sentinel.pid);
  const path = join(f.root, ".degreaser/runs", run.id, "run.json");
  try {
    const ambiguous = structuredClone(run);
    assert.ok(ambiguous.owner);
    ambiguous.owner.processes = [
      {
        pid: sentinel.pid,
        group: sentinel.pid,
        started: "Thu Jan 1 00:00:00 1970",
      },
    ];
    writeFileSync(path, JSON.stringify(ambiguous));
    const bytes = readFileSync(path);
    const result = f.run(["resume", run.id]);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /owner-unverified/);
    assert.match(result.stdout, /child PID was reused/);
    assert.match(result.stdout, /[Ii]nspect.*PID\/start\/group/);
    assert.match(result.stdout, /new review.*old work.*stopped/);
    assert.deepEqual(readFileSync(path), bytes);
    assert.ok(alive(sentinel.pid));
    assert.equal(f.events().length, 1);
  } finally {
    writeFileSync(path, JSON.stringify(run));
    sentinel.kill("SIGKILL");
    await exited;
  }
});

test("cancelled work resumes, while findings and their attempt evidence remain byte-for-byte stable", async (t) => {
  const f = queueFixture(t, { concurrency: 1 });
  f.setPlan({
    workers: { "low-value-comments": { resultGate: f.gate("blocked") } },
    results: {
      "masked-errors": {
        aspect: "masked-errors",
        status: "findings",
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
            title: "Synthetic source finding",
            evidence: "The source repeats its explanation.",
            consequence: "Duplicated explanation can drift.",
            countercheck: "No separate rationale is supplied.",
            recommendation: "Keep only useful rationale.",
          },
        ],
      },
    },
  });
  f.start(["--aspects", "masked-errors,low-value-comments,convention-drift"]);
  await until(
    () => f.events().length === 2,
    "Committed finding and active peer",
  );
  const id = f.state().id;
  assert.equal(f.run(["cancel", id]).status, 1);
  const cancelled = f.state();
  assert.deepEqual(
    cancelled.tasks.map((t) => t.status),
    ["findings", "cancelled", "cancelled"],
  );
  f.setPlan();
  const resumed = f.run(["resume", id, "--concurrency", "2", "--wait", "20"]);
  assert.equal(resumed.status, 0, resumed.stdout);
  const completed = f.state();
  assert.deepEqual(completed.tasks[0], cancelled.tasks[0]);
  assert.deepEqual(
    completed.tasks.map((t) => t.attempts.length),
    [1, 2, 1],
  );
  const path = join(f.root, ".degreaser/runs", id, "run.json");
  const bytes = readFileSync(path);
  for (let i = 0; i < 2; i++) {
    const result = f.run(["resume", id]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /already-completed/);
    assert.deepEqual(readFileSync(path), bytes);
  }
  assert.equal(f.events().length, 4);
});

test("retry and resume retain production source-only profile, fresh sessions, one rubric and worker-context recursion refusals", (t) => {
  const f = queueFixture(t, { maxRetries: 1 });
  const nestedCli = fileURLToPath(
    new URL("../dist/bin/degreaser-axi.js", import.meta.url),
  );
  f.setPlan({
    productionProfile: true,
    nestedCli,
    worker: {
      attempts: [
        { result: "" },
        {
          result: {
            aspect: "low-value-comments",
            status: "incomplete",
            findings: [],
            limitations: ["Needs another pass."],
          },
        },
        {},
      ],
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 1);
  const old = f.state();
  assert.equal(old.tasks[0]?.attempts.length, 2);
  const result = f.run(["resume", old.id, "--wait", "20"]);
  assert.equal(result.status, 0, result.stdout);
  const events = f.events();
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map((e) => e.sessionId)).size, 3);
  assert.ok(
    events.every(
      (e) =>
        e.model === "gpt-6-luna" &&
        e.agent === "codex" &&
        e.prompt?.match(/Assigned aspect: [a-z-]+$/gm)?.length === 1,
    ),
  );
  // Declared full coverage left an obligation open, so resume targets it.
  assert.equal(events[0]?.prompt, events[1]?.prompt);
  assert.match(events[2]?.prompt ?? "", /# Unresolved obligations/);
  assert.equal(
    events[0]?.prompt?.match(/Assigned aspect: [a-z-]+$/gm)?.length,
    1,
  );
  const profiles = f.lifecycle().filter((e) => e.type === "initialize");
  assert.equal(profiles.length, 3);
  for (const event of profiles) {
    assert.equal(event.workerMarker, "1");
    assert.equal(event.initialMode, "read-only");
    assert.equal(event.codexConfig?.sandbox_mode, "read-only");
    assert.equal(event.codexConfig?.approval_policy, "never");
    assert.equal(event.codexConfig?.web_search, "disabled");
    assert.equal(event.codexConfig?.features.multi_agent, false);
    assert.equal(event.codexConfig?.features.hooks, false);
  }
  const nested = f.lifecycle().filter((e) => e.type === "nested");
  assert.equal(nested.length, 6);
  assert.ok(
    nested.every((e) => e.code === 2 && e.stdout?.includes("nested-review")),
  );
  assert.deepEqual(readdirSync(join(f.root, ".degreaser/runs")), [old.id]);
  assert.deepEqual(
    f.state().tasks[0]?.attempts.slice(0, 2),
    old.tasks[0]?.attempts,
  );
});
