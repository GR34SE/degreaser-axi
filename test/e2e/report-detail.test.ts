import assert from "node:assert/strict";

import { readFileSync, rmSync } from "node:fs";

import { join } from "node:path";

import test from "node:test";

import { saveRun } from "../../src/state/store.ts";

import { alive, queueFixture, until } from "../utils/queue-fixture.ts";

import { decode, finding, result, snapshot } from "../utils/report-fixture.ts";

test("short coverage attributes incomplete limitations and full reports separate configuration, coordinator results and executions", async (t) => {
  const longLimitation = `Unexamined assessed paths: ${"unexamined-file.ts, ".repeat(80)}`;
  const f = queueFixture(t);
  f.write("source.ts", "new line 1\n");
  f.setPlan({
    results: {
      "missed-reuse": result("missed-reuse", [
        finding(1),
        finding(1, 1, "new", "absent.ts"),
      ]),
      "masked-errors": {
        ...result(
          "masked-errors",
          [],
          [
            "Could not inspect the error handler.",
            "Generated caller skipped.",
            longLimitation,
          ],
        ),
        reason: "Could not inspect the error handler.",
      },
      "low-value-comments": result("low-value-comments", []),
    },
  });
  const reviewed = f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Audit source",
    "--aspects",
    "missed-reuse,masked-errors,low-value-comments,scope-creep",
  ]);
  assert.equal(reviewed.status, 1, reviewed.stdout);
  const short = decode(reviewed.stdout);
  assert.equal(short.status, "partial");
  assert.equal(short.aspects, "3/4");
  assert.equal(short.count, 1);
  assert.equal(short.rejected, 1);
  assert.equal(short.usage, "unknown");
  assert.equal(short.coverageBasis, "worker-declared");
  assert.ok(short.help.includes(`degreaser-axi report ${short.run} --full`));
  assert.ok(!reviewed.stdout.includes(longLimitation));
  const incomplete = short.coverage.find(
    (row: { aspect: string }) => row.aspect === "masked-errors",
  );
  assert.equal(incomplete.reason, "Could not inspect the error handler.");
  assert.ok(incomplete.limitations.includes("Generated caller skipped."));
  assert.ok(
    !incomplete.limitations.includes("Could not inspect the error handler."),
  );
  const harness = [
    "Synthetic external adapter; not a live provider result.",
    "codex does not natively enforce maxTurns (40); the instruction budget is advisory. Attempt and run deadlines are enforced.",
  ];
  assert.ok(!short.limitations.includes("Generated caller skipped."));
  for (const limitation of harness)
    assert.equal(
      short.limitations.filter((l: string) => l === limitation).length,
      1,
      limitation,
    );
  for (const row of short.coverage)
    for (const limitation of harness)
      assert.ok(!row.limitations.includes(limitation), row.aspect);
  const clean = short.coverage.find(
    (row: { aspect: string }) => row.aspect === "low-value-comments",
  );
  assert.ok(!("reason" in clean));
  assert.equal(
    short.coverage.find(
      (row: { aspect: string }) => row.aspect === "missed-reuse",
    ).rejected,
    1,
  );
  const full = decode(f.run(["report", "--full"]).stdout);
  assert.ok(
    full.coverage
      .find((row: { aspect: string }) => row.aspect === "masked-errors")
      .limitations.includes(longLimitation),
  );
  assert.equal(full.pathList, `.degreaser/runs/${short.run}/input/review.json`);
  assert.equal(
    full.paths,
    JSON.parse(readFileSync(join(f.root, full.pathList), "utf8")).paths.length,
  );
  assert.deepEqual(
    full.configuration,
    ["masked-errors", "scope-creep", "missed-reuse", "low-value-comments"].map(
      (aspect) => ({
        aspect,
        agent: "codex",
        model: "gpt-6-luna",
      }),
    ),
  );
  assert.deepEqual(
    full.execution.map((row: { aspect: string }) => row.aspect),
    ["masked-errors", "missed-reuse", "low-value-comments"],
  );
  assert.equal(full.coordinator[0].aspect, "scope-creep");
  assert.equal(full.coordinator[0].status, "not-applicable");
  assert.match(full.coordinator[0].reason, /no feature-change scope/);
  assert.equal(f.events().length, 3);
  assert.match(reviewed.stderr, /workers: 3;/);
  assert.equal(reviewed.stderr.trim().split("\n").length, 1);
  const run = f.state();
  const owner = run.owner;
  if (owner)
    await until(
      () => !alive(owner.pid),
      "Owner exits before stored metadata fixture",
    );
  const executed = run.tasks.filter((task) => task.attempts.length);
  for (const task of executed) {
    const attempt = task.attempts.at(-1);
    assert.ok(attempt);
    attempt.usage =
      task.assignment.aspect === "missed-reuse" ? { inputTokens: 17 } : {};
    task.usage = { inputTokens: 999 };
  }
  saveRun(run);
  const mixedUsage = decode(f.run(["report", "--full"]).stdout);
  assert.equal(mixedUsage.usage, "unknown");
  assert.equal(mixedUsage.execution[0].usage, "unknown");
  assert.deepEqual(mixedUsage.execution[1].usage, { inputTokens: 17 });
  for (const task of executed) {
    const attempt = task.attempts.at(-1);
    assert.ok(attempt);
    attempt.usage = { inputTokens: 17, outputTokens: 3 };
  }
  saveRun(run);
  assert.deepEqual(decode(f.run(["report"]).stdout).usage, [
    { aspect: "masked-errors", inputTokens: 17, outputTokens: 3 },
    { aspect: "missed-reuse", inputTokens: 17, outputTokens: 3 },
    { aspect: "low-value-comments", inputTokens: 17, outputTokens: 3 },
  ]);
  const audit = f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Check applicability",
    "--aspects",
    "scope-creep",
  ]);
  assert.equal(audit.status, 0, audit.stdout);
  const coordinatorOnly = decode(f.run(["report", "--full"]).stdout);
  assert.deepEqual(coordinatorOnly.execution, []);
  assert.deepEqual(coordinatorOnly.configuration, [
    { aspect: "scope-creep", agent: "codex", model: "gpt-6-luna" },
  ]);
  assert.equal(coordinatorOnly.aspects, "1/1");
  assert.equal(coordinatorOnly.count, 0);
  assert.equal(coordinatorOnly.usage, "unknown");
  assert.equal(coordinatorOnly.coverage[0].status, "not-applicable");
  assert.equal(f.events().length, 3);
});

test("row limits and historical detail preserve all evidence, uncertainty and aspect limitations", async (t) => {
  const f = queueFixture(t);
  f.write(
    "source.ts",
    Array.from({ length: 35 }, (_, n) => `new line ${n + 1}\n`).join(""),
  );
  const evidence = `${"Long source evidence, with commas and a newline.\n".repeat(60)}END-EVIDENCE`;
  const entries = Array.from({ length: 35 }, (_, n) => ({
    ...finding(n + 1),
    evidence,
    countercheck: `${"Checked another caller. ".repeat(60)}END-COUNTERCHECK`,
    recommendation: `${"Keep required behavior. ".repeat(60)}END-RECOMMENDATION`,
    uncertainty: "Runtime behavior was not measured.",
  }));
  f.setPlan({
    results: {
      "low-value-comments": result("low-value-comments", entries, [
        "Unexamined generated caller.",
      ]),
    },
  });
  const first = f.run([
    "review",
    "--scope",
    "branch",
    "--base",
    "main",
    "--task",
    "Update source",
    "--aspects",
    "low-value-comments",
  ]);
  assert.equal(first.status, 1, first.stdout);
  const short = decode(first.stdout);
  assert.equal(short.count, 35);
  assert.equal(short.shown, 30);
  assert.equal(short.findings.length, 30);
  assert.ok(short.help.includes(`degreaser-axi report ${short.run} --full`));
  assert.ok(
    short.help.some(
      (command: string) =>
        command.includes("--scope branch") && command.includes("--base main"),
    ),
  );
  const full = decode(f.run(["report", short.run, "--full"]).stdout);
  assert.equal(full.shown, 35);
  for (let n = 0; n < entries.length; n++) {
    const {
      id: _id,
      group: _group,
      aspect: _aspect,
      ...actual
    } = full.findings[n];
    assert.deepEqual(actual, entries[n]);
  }
  const detail = decode(f.run(["finding", "F35", "--run", short.run]).stdout);
  assert.equal(detail.evidence, evidence);
  assert.equal(detail.countercheck, entries[34]?.countercheck);
  assert.equal(detail.recommendation, entries[34]?.recommendation);
  assert.equal(detail.uncertainty, entries[34]?.uncertainty);
  assert.ok(detail.limitations.includes("Unexamined generated caller."));
  f.setPlan();
  f.start(["--aspects", "low-value-comments"]);
  assert.equal(f.finish().status, 0);
  assert.notEqual(decode(f.run(["report"]).stdout).run, short.run);
  assert.equal(decode(f.run(["report", short.run]).stdout).run, short.run);
  assert.equal(
    decode(f.run(["finding", "F35", "--run", short.run]).stdout).evidence,
    evidence,
  );
  assert.equal(
    decode(f.run(["finding", "F35"]).stdout).code,
    "finding-not-found",
  );
  const other = queueFixture(t);
  const noHistory = other.run(["report"]);
  assert.equal(noHistory.status, 2);
  assert.equal(decode(noHistory.stdout).code, "no-history");
  rmSync(join(other.root, ".degreaserrc.json"));
  const noConfig = decode(other.run(["home"]).stdout);
  assert.equal(noConfig.configuration, "unconfigured");
  assert.equal(noConfig.history, "no-history");
  assert.equal(
    decode(other.run(["report", short.run]).stdout).code,
    "run-not-found",
  );
  const run = f.state();
  const owner = run.owner;
  if (owner) await until(() => !alive(owner.pid), "Latest owner exits");
  const before = snapshot(f.root);
  for (const args of [
    ["report"],
    ["report", short.run, "--full"],
    ["finding", "F35", "--run", short.run],
  ])
    f.run(args);
  assert.deepEqual(snapshot(f.root), before);
});
