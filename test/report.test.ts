import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import type { AspectId } from "../src/config.ts";
import type { Finding, WorkerResult } from "../src/results.ts";
import { saveRun } from "../src/storage.ts";
import { alive, queueFixture, until } from "./queue-fixture.ts";

// Decode the actual stdout with the encoder's installed public TOON consumer.
const { decode } = createRequire(import.meta.resolve("axi-sdk-js"))(
  "@toon-format/toon",
);

function finding(
  startLine: number,
  endLine = startLine,
  side: "old" | "new" = "new",
  path = "source.ts",
): Finding {
  return {
    location: { path, side, startLine, endLine },
    quote: `${side} line ${startLine}`,
    title: "Independent source cost",
    evidence: `Evidence at ${path}:${side}:${startLine}`,
    consequence: "Extra maintenance.",
    countercheck: "The neighboring caller does not need this behavior.",
    recommendation: "Remove the redundant behavior.",
  };
}

function result(
  aspect: AspectId,
  findings: Finding[],
  limitations: string[] = [],
): WorkerResult {
  return {
    aspect,
    status: limitations.length
      ? "incomplete"
      : findings.length
        ? "findings"
        : "no-findings",
    findings,
    limitations,
  };
}

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path, readFileSync(path).toString("base64")];
      }),
  );
}

test("compiled reports group transitive same-side overlaps with stable evidence ties across completion permutations", async (t) => {
  const f = queueFixture(t);
  const lines = (side: string) =>
    Array.from({ length: 40 }, (_, n) => `${side} line ${n + 1}\n`).join("");
  f.write("source.ts", lines("old"));
  f.git("add", ".");
  f.git("commit", "-m", "Old source coordinates");
  f.write("source.ts", lines("new"));
  f.write("z.ts", "new line 1\n");
  const tie = finding(20);
  const results = [
    result("A01", [
      finding(1, 4),
      finding(11),
      { ...tie, evidence: "beta" },
      { ...tie, evidence: "alpha" },
      finding(1, 1, "new", "z.ts"),
    ]),
    result("A04", [finding(4, 7), finding(2, 3, "old")]),
    result("A06", [finding(7, 9), finding(1, 4)]),
  ];
  let previous: unknown;
  for (const order of [
    ["A01", "A04", "A06"],
    ["A06", "A04", "A01"],
  ]) {
    const prefix = order[0];
    f.setPlan({
      results: Object.fromEntries(
        results.map((r) => [
          r.aspect,
          {
            ...r,
            findings: prefix === "A06" ? [...r.findings].reverse() : r.findings,
          },
        ]),
      ),
      workers: Object.fromEntries(
        order.map((aspect) => [
          aspect,
          { resultGate: f.gate(`${prefix}-${aspect}`) },
        ]),
      ),
    });
    const started = f.start(["--aspects", "A01,A04,A06"]);
    assert.equal(started.status, 3, started.stdout);
    await until(
      () => f.state().tasks.every((task) => task.attempts.length === 1),
      "All selected workers must be admitted before permuting completion",
    );
    for (const aspect of order) {
      f.release(`${prefix}-${aspect}`);
      await until(
        () =>
          !!f.state().tasks.find((task) => task.assignment.aspect === aspect)
            ?.result,
        `Expected ${aspect} result before releasing its peer`,
      );
    }
    assert.equal(f.finish().status, 0);
    const full = f.run(["report", "--full"]);
    assert.equal(full.status, 0, full.stdout);
    assert.equal(full.stderr, "");
    const report = decode(full.stdout);
    assert.deepEqual(
      report.findings.map(
        (entry: {
          id: string;
          group: string;
          aspect: string;
          location: Finding["location"];
          evidence: string;
        }) => [
          entry.id,
          entry.group,
          entry.aspect,
          entry.location.path,
          entry.location.side,
          entry.location.startLine,
          entry.evidence,
        ],
      ),
      [
        [
          "F1",
          "G1",
          "A01",
          "source.ts",
          "new",
          1,
          "Evidence at source.ts:new:1",
        ],
        [
          "F2",
          "G1",
          "A06",
          "source.ts",
          "new",
          1,
          "Evidence at source.ts:new:1",
        ],
        [
          "F3",
          "G1",
          "A04",
          "source.ts",
          "new",
          4,
          "Evidence at source.ts:new:4",
        ],
        [
          "F4",
          "G1",
          "A06",
          "source.ts",
          "new",
          7,
          "Evidence at source.ts:new:7",
        ],
        [
          "F5",
          "G2",
          "A04",
          "source.ts",
          "old",
          2,
          "Evidence at source.ts:old:2",
        ],
        [
          "F6",
          "G3",
          "A01",
          "source.ts",
          "new",
          11,
          "Evidence at source.ts:new:11",
        ],
        ["F7", "G4", "A01", "source.ts", "new", 20, "alpha"],
        ["F8", "G4", "A01", "source.ts", "new", 20, "beta"],
        ["F9", "G5", "A01", "z.ts", "new", 1, "Evidence at z.ts:new:1"],
      ],
    );
    assert.equal(f.run(["report", "--full"]).stdout, full.stdout);
    if (previous) assert.deepEqual(report.findings, previous);
    previous = report.findings;
    const short = decode(f.run(["report"]).stdout);
    assert.deepEqual(
      short.findings.map((entry: { group: string }) => entry.group),
      ["G1", "G1", "G1", "G1", "G2", "G3", "G4", "G4", "G5"],
    );
    const detail = decode(f.run(["finding", "F7", "--run", report.run]).stdout);
    assert.equal(detail.group, "G4");
    assert.equal(detail.evidence, "alpha");
  }
  assert.equal(
    f.events().length,
    6,
    "Grouping/reads must not invoke another reviewer",
  );
});

test("short coverage attributes incomplete limitations and full reports separate configuration, coordinator results and executions", async (t) => {
  const f = queueFixture(t);
  f.write("source.ts", "new line 1\n");
  f.setPlan({
    results: {
      A01: result("A01", [finding(1), finding(1, 1, "new", "absent.ts")]),
      A04: {
        ...result(
          "A04",
          [],
          ["Could not inspect the error handler.", "Generated caller skipped."],
        ),
        reason: "Could not inspect the error handler.",
      },
      A06: result("A06", []),
    },
  });
  const reviewed = f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Audit source",
    "--aspects",
    "A01,A04,A06,A08",
  ]);
  assert.equal(reviewed.status, 1, reviewed.stdout);
  const short = decode(reviewed.stdout);
  assert.equal(short.status, "partial");
  assert.equal(short.aspects, "3/4");
  assert.equal(short.count, 1);
  assert.equal(short.rejected, 1);
  assert.equal(short.usage, "unknown");
  const incomplete = short.coverage.find(
    (row: { aspect: string }) => row.aspect === "A04",
  );
  // Reason is not repeated; harness/profile limitations appear once at run level.
  assert.equal(incomplete.reason, "Could not inspect the error handler.");
  assert.ok(incomplete.limitations.includes("Generated caller skipped."));
  assert.ok(
    !incomplete.limitations.includes("Could not inspect the error handler."),
  );
  const harness = [
    "Synthetic external adapter; not a live provider result.",
    "codex does not natively enforce maxTurns (40); the instruction budget is advisory. Attempt and run deadlines are enforced.",
  ];
  for (const limitation of [...harness, "Generated caller skipped."])
    assert.equal(
      short.limitations.filter((l: string) => l === limitation).length,
      1,
      limitation,
    );
  for (const row of short.coverage)
    for (const limitation of harness)
      assert.ok(!row.limitations.includes(limitation), row.aspect);
  const clean = short.coverage.find(
    (row: { aspect: string }) => row.aspect === "A06",
  );
  assert.ok(!("reason" in clean));
  assert.equal(short.coverage[0].rejected, 1);
  const full = decode(f.run(["report", "--full"]).stdout);
  assert.equal(full.pathList, `.degreaser/runs/${short.run}/input/review.json`);
  assert.equal(
    full.paths,
    JSON.parse(readFileSync(join(f.root, full.pathList), "utf8")).paths.length,
  );
  assert.deepEqual(
    full.configuration,
    ["A01", "A04", "A06", "A08"].map((aspect) => ({
      aspect,
      agent: "codex",
      model: "gpt-6-luna",
    })),
  );
  assert.deepEqual(
    full.execution.map((row: { aspect: string }) => row.aspect),
    ["A01", "A04", "A06"],
  );
  assert.equal(full.coordinator[0].aspect, "A08");
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
  // Synthetic saved metadata tests presentation, not a live provider usage claim.
  const executed = run.tasks.filter((task) => task.attempts.length);
  for (const task of executed) {
    const attempt = task.attempts.at(-1);
    assert.ok(attempt);
    attempt.usage = task.assignment.aspect === "A01" ? { inputTokens: 17 } : {};
    // Earlier saved task summaries can be stale; only attempt metadata is attributed.
    task.usage = { inputTokens: 999 };
  }
  saveRun(run);
  const mixedUsage = decode(f.run(["report", "--full"]).stdout);
  assert.equal(mixedUsage.usage, "unknown");
  assert.deepEqual(mixedUsage.execution[0].usage, { inputTokens: 17 });
  assert.equal(mixedUsage.execution[1].usage, "unknown");
  for (const task of executed) {
    const attempt = task.attempts.at(-1);
    assert.ok(attempt);
    attempt.usage = { inputTokens: 17, outputTokens: 3 };
  }
  saveRun(run);
  assert.deepEqual(decode(f.run(["report"]).stdout).usage, [
    { aspect: "A01", inputTokens: 17, outputTokens: 3 },
    { aspect: "A04", inputTokens: 17, outputTokens: 3 },
    { aspect: "A06", inputTokens: 17, outputTokens: 3 },
  ]);
  const audit = f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Check applicability",
    "--aspects",
    "A08",
  ]);
  assert.equal(audit.status, 0, audit.stdout);
  const coordinatorOnly = decode(f.run(["report", "--full"]).stdout);
  assert.deepEqual(coordinatorOnly.execution, []);
  assert.deepEqual(coordinatorOnly.configuration, [
    { aspect: "A08", agent: "codex", model: "gpt-6-luna" },
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
    results: { A06: result("A06", entries, ["Unexamined generated caller."]) },
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
    "A06",
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
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  assert.notEqual(decode(f.run(["report"]).stdout).run, short.run);
  assert.equal(decode(f.run(["report", short.run]).stdout).run, short.run);
  assert.equal(
    decode(f.run(["finding", "F35", "--run", short.run]).stdout).evidence,
    evidence,
  );
  assert.equal(
    decode(f.run(["finding", "F35"]).stdout).error,
    "finding-not-found",
  );
  const other = queueFixture(t);
  const noHistory = other.run(["report"]);
  assert.equal(noHistory.status, 2);
  assert.equal(decode(noHistory.stdout).error, "no-history");
  rmSync(join(other.root, ".degreaserrc.json"));
  const noConfig = decode(other.run(["home"]).stdout);
  assert.equal(noConfig.configuration, "unconfigured");
  assert.equal(noConfig.history, "no-history");
  assert.equal(
    decode(other.run(["report", short.run]).stdout).error,
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

test("home observes configuration and history independently and all read commands preserve local files", async (t) => {
  const f = queueFixture(t);
  f.write(".claude/settings.json", '{"foreign":"preserve"}\n');
  const absent = decode(f.run(["home"]).stdout);
  assert.equal(absent.configuration, "configured");
  assert.equal(absent.history, "no-history");
  assert.ok(absent.bin);
  assert.ok(absent.description);
  f.setPlan({
    results: { A06: result("A06", [{ ...finding(1), quote: "// redundant" }]) },
  });
  f.start(["--aspects", "A06"]);
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
  assert.equal(f.run(["doctor"]).status, 2);
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
    assert.equal(error.error, "state-corrupt");
    assert.ok(error.reason.includes(file));
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
      A01: result(
        "A01",
        Array.from({ length: 35 }, (_, n) => finding(n + 1)),
      ),
    },
    workers: { A04: { resultGate: f.gate("finish") } },
  });
  const start = f.start(["--aspects", "A01,A04", "--concurrency", "2"]);
  assert.equal(start.status, 3, start.stdout);
  await until(
    () => !!f.state().tasks[0]?.result,
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
    "A06",
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
  assert.equal(input.configuration[0].aspect, "A06");
  assert.equal(f.events().length, 2);
});

test("a dismissed finding is stored per repository and passed to later reviews of that file", (t) => {
  const f = queueFixture(t);
  f.write("source.ts", "new line 1\n");
  f.setPlan({ results: { A06: result("A06", [finding(1)]) } });
  f.start(["--aspects", "A06"]);
  const first = decode(f.finish().stdout);
  assert.equal(first.count, 1);
  const missing = decode(f.run(["dismiss", "F1"]).stdout);
  assert.equal(missing.error, "invalid-input");
  const dismissed = decode(
    f.run(["dismiss", "F1", "--reason", "Kept for old clients"]).stdout,
  );
  assert.equal(dismissed.status, "dismissed");
  const stored = join(f.root, ".git/degreaser/dismissed.json");
  assert.equal(realpathSync(dismissed.stored), realpathSync(stored));
  assert.match(readFileSync(stored, "utf8"), /Kept for old clients/);
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  const prompts = f.events().map((e) => e.prompt ?? "");
  assert.doesNotMatch(prompts[0] ?? "", /Kept for old clients/);
  assert.match(prompts.at(-1) ?? "", /Kept for old clients/);
});
