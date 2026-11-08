import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";

import test from "node:test";

import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

import { decode, finding, result, snapshot } from "../utils/report-fixture.ts";

test("home observes configuration and history independently and all read commands preserve local files", async (t) => {
  const f = queueFixture(t);
  f.write(".claude/settings.json", '{"foreign":"preserve"}\n');
  const absent = decode(f.run(["home"]).stdout);
  assert.equal(absent.configuration, "configured");
  assert.equal(absent.history, "no-history");
  assert.ok(absent.bin);
  assert.ok(absent.description);
  f.setPlan({
    results: {
      "low-value-comments": result("low-value-comments", [
        { ...finding(1), quote: "// redundant" },
      ]),
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const owner = run.owner;
  if (owner)
    await until(
      () => !alive(owner.pid),
      "Owner exits before read-only snapshot",
    );
  const before = snapshot(f.root);
  const events = f.events();
  const lifecycle = readFileSync(f.gate("lifecycle.jsonl"), "utf8");
  for (const args of [
    [],
    ["home"],
    ["doctor"],
    ["report"],
    ["finding", "F1"],
  ]) {
    const response = f.run(args);
    assert.equal(response.status, 0, response.stdout);
    assert.equal(response.stderr, "");
    assert.ok(decode(response.stdout));
  }
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(f.events(), events);
  assert.equal(readFileSync(f.gate("lifecycle.jsonl"), "utf8"), lifecycle);
  rmSync(join(f.root, ".degreaserrc.json"));
  const noConfig = snapshot(f.root);
  const home = decode(f.run(["home"]).stdout);
  assert.equal(home.configuration, "unconfigured");
  assert.equal(home.run, run.id, "History remains readable without current RC");
  assert.equal(home.status, "completed");
  assert.equal(decode(f.run(["report"]).stdout).run, run.id);
  const doctor = f.run(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.equal(decode(doctor.stdout).configuration, "missing");
  assert.deepEqual(snapshot(f.root), noConfig);
  f.write(".degreaserrc.json", "{");
  const invalid = f.run(["home"]);
  assert.equal(invalid.status, 2);
  assert.equal(decode(invalid.stdout).configuration, "invalid");
  assert.equal(decode(invalid.stdout).run, run.id);
  rmSync(join(f.root, ".degreaserrc.json"));
  const file = join(f.root, ".degreaser/runs", run.id, "run.json");
  const original = readFileSync(file, "utf8");
  for (const damaged of [
    "{",
    JSON.stringify({ ...JSON.parse(original), schemaVersion: 99 }),
  ]) {
    writeFileSync(file, damaged);
    const read = f.run(["report", run.id]);
    assert.equal(read.status, 2);
    const error = decode(read.stdout);
    assert.equal(error.code, "state-corrupt");
    assert.ok(error.error.includes(file));
    const damagedHome = f.run(["home"]);
    assert.equal(damagedHome.status, 2);
    assert.equal(decode(damagedHome.stdout).history, "state-corrupt");
    assert.equal(readFileSync(file, "utf8"), damaged);
  }
  writeFileSync(file, original);
});

test("running reports are immediate saved-result observations with same-run actions and bounded channels", async (t) => {
  const f = queueFixture(t);
  f.write(
    "source.ts",
    Array.from({ length: 35 }, (_, n) => `new line ${n + 1}\n`).join(""),
  );
  f.setPlan({
    results: {
      "missed-reuse": result(
        "missed-reuse",
        Array.from({ length: 35 }, (_, n) => finding(n + 1)),
      ),
    },
    workers: { "masked-errors": { resultGate: f.gate("finish") } },
  });
  const start = f.start([
    "--aspects",
    "missed-reuse,masked-errors",
    "--concurrency",
    "2",
  ]);
  assert.equal(start.status, 3, start.stdout);
  await until(
    () =>
      !!f
        .state()
        .tasks.find((task) => task.assignment.aspect === "missed-reuse")
        ?.result,
    "First useful result before read",
  );
  const state = f.state();
  const report = f.run(["report"]);
  assert.equal(report.status, 3, report.stdout);
  assert.equal(report.stderr, "");
  const data = decode(report.stdout);
  assert.equal(data.status, "running");
  assert.equal(data.aspects, "1/2");
  assert.ok(data.help.includes(`degreaser-axi wait ${state.id}`));
  assert.equal(data.count, 35);
  assert.equal(data.shown, 30);
  assert.ok(data.help.includes(`degreaser-axi report ${state.id} --full`));
  const full = f.run(["report", state.id, "--full"]);
  assert.equal(full.status, 3);
  assert.equal(decode(full.stdout).shown, 35);
  assert.deepEqual(f.state().tasks, state.tasks);
  assert.equal(f.events().length, 2);
  assert.equal(start.stderr.trim().split("\n").length, 1);
  assert.ok(start.stderr.includes(`run: ${state.id}; workers: 2;`));
  assert.ok(
    start.stderr.includes("identities: codex/gpt-6-luna; concurrency: 2;"),
  );
  assert.ok(start.stderr.includes(new Date(state.deadline).toISOString()));
  assert.equal(state.executions?.[0]?.concurrency, 2);
  const early = f.run(["dismiss", "F1", "--reason", "Kept on purpose"]);
  assert.equal(early.status, 2, early.stdout);
  assert.equal(decode(early.stdout).code, "run-active");
  f.release("finish");
  assert.equal(f.finish().status, 0);
});

test("suggested reviews preserve explicit scope, base, task and selection as literal shell arguments", (t) => {
  const f = queueFixture(t);
  const base = "target'$VALUE";
  const task = "--flag $(touch COMMAND-EXPANDED) 'quoted'\nsecond line";
  f.git("branch", base);
  const first = f.run([
    "review",
    "--scope",
    "branch",
    "--base",
    base,
    `--task=${task}`,
    "--aspects",
    "low-value-comments",
  ]);
  assert.equal(first.status, 0, first.stdout);
  const command = decode(first.stdout).help.find((text: string) =>
    text.startsWith("degreaser-axi review "),
  );
  assert.ok(command);
  const parsed = spawnSync(
    "/bin/sh",
    ["-c", `set -- ${command}; printf '%s\\0' "$@"`],
    {
      cwd: f.root,
      encoding: "utf8",
      timeout: 1000,
    },
  );
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.ok(!existsSync(join(f.root, "COMMAND-EXPANDED")));
  const argv = parsed.stdout.split("\0").slice(1, -1);
  const next = f.run(argv);
  assert.equal(next.status, 0, next.stdout);
  const input = decode(f.run(["report", "--full"]).stdout);
  assert.equal(input.scope, "branch");
  assert.equal(input.task, task);
  assert.equal(input.configuration.length, 1);
  assert.equal(input.configuration[0].aspect, "low-value-comments");
  assert.equal(f.events().length, 2);
});

test("a dismissed finding is stored per repository and passed to later reviews of that file", (t) => {
  const f = queueFixture(t);
  f.write("source.ts", "new line 1\n");
  f.setPlan({
    results: {
      "low-value-comments": result("low-value-comments", [finding(1)]),
    },
  });
  f.start(["--aspects", "low-value-comments"]);
  const first = decode(f.finish().stdout);
  assert.equal(first.count, 1);
  const missing = decode(f.run(["dismiss", "F1"]).stdout);
  assert.equal(missing.code, "invalid-input");
  const dismissed = decode(
    f.run(["dismiss", "F1", "--reason", "Kept for old clients"]).stdout,
  );
  assert.equal(dismissed.status, "dismissed");
  const stored = join(f.root, ".git/degreaser/dismissed.json");
  assert.equal(realpathSync(dismissed.stored), realpathSync(stored));
  assert.match(readFileSync(stored, "utf8"), /Kept for old clients/);
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  const prompts = f.events().map((e) => e.prompt ?? "");
  assert.doesNotMatch(prompts[0] ?? "", /Kept for old clients/);
  assert.match(prompts.at(-1) ?? "", /Kept for old clients/);
  writeFileSync(stored, "[null]\n");
  const corrupt = f.start(["--aspects", "low-value-comments"]);
  assert.equal(corrupt.status, 2, corrupt.stdout);
  assert.equal(decode(corrupt.stdout).code, "state-corrupt");
});

test("export prints the run as plain JSON with flattened, unclipped findings", (t) => {
  const f = queueFixture(t);
  f.write("source.ts", "new line 1\n");
  const entry = { ...finding(1), evidence: "x".repeat(5_000) };
  f.setPlan({
    results: { "low-value-comments": result("low-value-comments", [entry]) },
  });
  f.start(["--aspects", "low-value-comments"]);
  const done = decode(f.finish().stdout);
  const exported = f.run(["export"]);
  assert.equal(exported.status, 0, exported.stdout);
  const data = JSON.parse(exported.stdout);
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.run, done.run);
  assert.equal(data.task, "Update source");
  const { location, ...fields } = entry;
  assert.deepEqual(data.findings[0], {
    id: "F1",
    group: "G1",
    aspect: "low-value-comments",
    ...fields,
    ...location,
  });
  assert.equal(data.coverage[0].aspect, "low-value-comments");
});
