import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function runScenario(node, packageRoot) {
  packageRoot = realpathSync(packageRoot);
  const temp = mkdtempSync(join(tmpdir(), "degreaser-qa-"));
  const repo = join(temp, "repo");
  const external = join(temp, "external");
  const home = join(temp, "home");
  const plan = join(external, "plan.json");
  const log = join(external, "prompts.jsonl");
  const lifecycleLog = join(external, "lifecycle.jsonl");
  const cli = join(packageRoot, "dist/bin/degreaser-axi.js");
  const runDir = join(repo, ".degreaser/runs");
  const environment = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    CODEX_HOME: join(home, "codex"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    PI_CODING_AGENT_DIR: join(home, "pi"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    TMPDIR: temp,
    QA_PROFILE: join(packageRoot, "dist/src/native-profile.js"),
    QA_ADAPTER: join(external, "review-acp.mjs"),
    SYNTHETIC_PLAN: plan,
    NODE_OPTIONS: `--import=${join(external, "register.mjs")}`,
  };
  const commands = [];
  try {
    mkdirSync(repo);
    mkdirSync(external);
    mkdirSync(home);
    mkdirSync(join(external, "node_modules"));
    for (const name of ["register.mjs", "loader.mjs"])
      cpSync(join(root, "test/qa", name), join(external, name));
    cpSync(
      join(root, "test/fixtures/review-acp.mjs"),
      join(external, "review-acp.mjs"),
    );
    const require = createRequire(join(packageRoot, "package.json"));
    const axiPath = require.resolve
      .paths("axi-sdk-js")
      .map((path) => join(path, "axi-sdk-js", "package.json"))
      .find(existsSync);
    assert.ok(axiPath, "Installed axi-sdk-js is missing");
    const { decode } = createRequire(realpathSync(axiPath))(
      "@toon-format/toon",
    );
    symlinkSync(
      dirname(dirname(require.resolve("acpx/runtime"))),
      join(external, "node_modules/acpx"),
    );
    const git = (...args) => {
      const result = spawnSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        timeout: 15_000,
      });
      assert.equal(result.status, 0, result.stderr);
    };
    const run = (args, status) => {
      const result = spawnSync(node, [cli, ...args], {
        cwd: repo,
        env: environment,
        encoding: "utf8",
        timeout: 60_000,
      });
      commands.push(`${args.join(" ")} => ${result.status ?? "timeout/error"}`);
      assert.equal(result.error, undefined, `${args}: ${result.error}`);
      assert.equal(
        result.status,
        status,
        `${args}: ${result.stdout}\n${result.stderr}`,
      );
      return result.stdout;
    };
    const setPlan = (extra = {}) =>
      writeFileSync(plan, JSON.stringify({ log, lifecycleLog, ...extra }));
    const state = () =>
      JSON.parse(readFileSync(join(repo, ".degreaser/state.json"), "utf8"));
    const currentRun = () =>
      JSON.parse(
        readFileSync(join(runDir, state().latestRunId, "run.json"), "utf8"),
      );
    const finding = {
      location: { path: "source.ts", side: "new", startLine: 1, endLine: 1 },
      quote: "// redundant",
      title: "Redundant comment",
      evidence: "The comment repeats the declaration.",
      consequence: "Extra text to maintain.",
      countercheck: "No constraint is explained.",
      recommendation: "Remove the comment.",
    };
    git("init", "-q");
    writeFileSync(join(repo, "source.ts"), "export const value = 1;\n");
    git("add", "source.ts");
    git("commit", "-qm", "Initial source");
    setPlan();
    const before = spawnSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: repo, encoding: "utf8" },
    ).stdout;
    assert.match(run(["init"], 2), /code: decision-required/);
    assert.equal(
      spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: repo,
        encoding: "utf8",
      }).stdout,
      before,
    );
    assert.deepEqual(readdirSync(home), []);
    assert.match(
      run(
        [
          "init",
          "--agent",
          "codex",
          "--model",
          "gpt-6-luna",
          "--harnesses",
          "claude,pi",
        ],
        0,
      ),
      /status: configured/,
    );
    const config = JSON.parse(
      readFileSync(join(repo, ".degreaserrc.json"), "utf8"),
    );
    assert.equal(config.agent, "codex");
    assert.equal(config.model, "gpt-6-luna");
    for (const path of [
      ".claude/settings.json",
      ".claude/skills/degreaser/SKILL.md",
      ".agents/skills/degreaser/SKILL.md",
      ".pi/extensions/degreaser.ts",
    ])
      assert.ok(
        existsSync(join(repo, path)),
        `Missing selected integration ${path}`,
      );
    writeFileSync(
      join(repo, "source.ts"),
      "// redundant\nexport const value = 2;\n",
    );
    const protectedPaths = [".degreaserrc.json", "source.ts", ".git/index"];
    const protectedBytes = protectedPaths.map((path) =>
      readFileSync(join(repo, path)),
    );
    const unchanged = () =>
      assert.deepEqual(
        protectedPaths.map((path) => readFileSync(join(repo, path))),
        protectedBytes,
      );
    setPlan({
      results: {
        "low-value-comments": {
          aspect: "low-value-comments",
          status: "findings",
          findings: [finding],
          limitations: [],
        },
      },
    });
    assert.match(
      run(
        [
          "review",
          "--scope",
          "worktree",
          "--task",
          "Review changed source",
          "--aspects",
          "low-value-comments",
          "--wait",
          "30",
        ],
        0,
      ),
      /status: completed/,
    );
    const firstRun = currentRun();
    const firstId = firstRun.id;
    assert.equal(firstRun.tasks.length, 1);
    assert.equal(firstRun.tasks[0].status, "findings");
    assert.deepEqual(firstRun.tasks[0].result.findings, [finding]);
    const firstReport = decode(run(["report", firstId, "--full"], 0));
    assert.equal(firstReport.run, firstId);
    assert.equal(firstReport.status, "completed");
    assert.equal(firstReport.evidence, "source-only");
    assert.equal(firstReport.aspects, "1/1");
    assert.equal(firstReport.count, 1);
    assert.deepEqual(
      firstReport.findings.map((f) => f.id),
      ["F1"],
    );
    assert.equal(firstReport.findings[0].title, finding.title);
    const firstFinding = decode(run(["finding", "F1", "--run", firstId], 0));
    assert.equal(firstFinding.id, "F1");
    assert.equal(firstFinding.quote, finding.quote);
    unchanged();
    setPlan({
      results: {
        "low-value-comments": {
          aspect: "low-value-comments",
          status: "findings",
          findings: [finding],
          limitations: [],
        },
      },
      workers: { "unjustified-defense": { result: "" } },
    });
    assert.match(
      run(
        [
          "review",
          "--scope",
          "worktree",
          "--task",
          "Review partial source",
          "--aspects",
          "unjustified-defense,low-value-comments",
          "--wait",
          "30",
        ],
        1,
      ),
      /status: partial/,
    );
    const partial = currentRun();
    const resolved = partial.tasks.find(
      (task) => task.assignment.aspect === "low-value-comments",
    );
    const unresolved = partial.tasks.find(
      (task) => task.assignment.aspect === "unjustified-defense",
    );
    assert.ok(resolved && unresolved);
    assert.notEqual(partial.id, firstId);
    assert.equal(unresolved.status, "failed");
    assert.equal(unresolved.attempts.length, 2);
    assert.deepEqual(
      unresolved.attempts.map((attempt) => attempt.failure),
      ["invalid-output", "invalid-output"],
    );
    assert.equal(resolved.status, "findings");
    assert.deepEqual(resolved.result.findings, [finding]);
    const partialReport = decode(run(["report", partial.id, "--full"], 1));
    assert.equal(partialReport.run, partial.id);
    assert.equal(partialReport.status, "partial");
    assert.equal(partialReport.evidence, "source-only");
    assert.equal(partialReport.aspects, "1/2");
    assert.deepEqual(
      partialReport.findings.map((f) => f.id),
      ["F1"],
    );
    assert.deepEqual(
      partialReport.coverage.map(({ aspect, status }) => [aspect, status]),
      [
        ["unjustified-defense", "failed"],
        ["low-value-comments", "findings"],
      ],
    );
    assert.ok(
      partialReport.help.includes(`degreaser-axi resume ${partial.id}`),
    );
    const detail = decode(run(["finding", "F1", "--run", partial.id], 0));
    assert.equal(detail.id, "F1");
    assert.equal(detail.quote, finding.quote);
    unchanged();
    const previousEvents = readFileSync(log, "utf8").trim().split("\n").length;
    setPlan();
    assert.match(
      run(["resume", partial.id, "--wait", "30"], 0),
      /status: completed/,
    );
    const completed = currentRun();
    assert.equal(completed.id, partial.id);
    assert.deepEqual(
      completed.tasks.find(
        (task) => task.assignment.aspect === "low-value-comments",
      ),
      resolved,
    );
    const retried = completed.tasks.find(
      (task) => task.assignment.aspect === "unjustified-defense",
    );
    assert.deepEqual(
      retried.attempts.slice(0, unresolved.attempts.length),
      unresolved.attempts,
    );
    assert.equal(retried.attempts.length, unresolved.attempts.length + 1);
    assert.equal(retried.status, "no-findings");
    const freshEvents = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .slice(previousEvents)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      freshEvents.map((event) => event.aspect),
      ["unjustified-defense"],
    );
    assert.equal(freshEvents[0].model, "gpt-6-luna");
    assert.deepEqual(
      decode(run(["finding", "F1", "--run", partial.id], 0)),
      detail,
    );
    const finalReport = decode(run(["report", partial.id, "--full"], 0));
    assert.equal(finalReport.run, partial.id);
    assert.equal(finalReport.status, "completed");
    assert.equal(finalReport.evidence, "source-only");
    assert.equal(finalReport.aspects, "2/2");
    assert.equal(finalReport.count, 1);
    assert.deepEqual(
      finalReport.findings.map((f) => f.id),
      ["F1"],
    );
    unchanged();
    console.log(
      `Deterministic CLI QA: Node ${process.version}, executable ${node}, package ${packageRoot}`,
    );
    console.log(`Completed run ${firstId}; partial/resumed run ${partial.id}.`);
    console.log(`Command/exit sequence: ${commands.join("; ")}`);
    console.log("Synthetic ACP fixture; no model inference.");
  } finally {
    await cleanupRuns({
      repo,
      runDir,
      external,
      lifecycleLog,
      node,
      cli,
      environment,
      temp,
    }).catch((error) => {
      throw new Error(
        `Could not confirm QA process cleanup; retained ${temp}`,
        { cause: error },
      );
    });
    rmSync(temp, { recursive: true, force: true });
  }
}

async function cleanupRuns({
  repo,
  runDir,
  external,
  lifecycleLog,
  node,
  cli,
  environment,
  temp,
}) {
  const deadline = Date.now() + 20_000;
  const cancelled = new Set();
  const ownerMarker = ` ${join(dirname(dirname(cli)), "bin/run-owner.js")} `;
  const adapter = join(external, "review-acp.mjs");
  const canonicalRepo = existsSync(repo) ? realpathSync(repo) : repo;
  for (;;) {
    const result = spawnSync(
      "/bin/ps",
      ["-ww", "-axo", "pid=,stat=,command="],
      {
        encoding: "utf8",
        timeout: 3_000,
        env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `Cannot inspect QA processes; retained ${temp}: ${result.error ?? result.stderr}`,
      );
    const rows = result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line);
        if (!match)
          throw new Error(`Cannot parse process list; retained ${temp}`);
        return { pid: Number(match[1]), state: match[2], command: match[3] };
      })
      .filter((row) => !row.state.startsWith("Z"));
    const owners = rows.filter(
      (row) =>
        row.command.includes(ownerMarker) &&
        row.command.includes(` ${canonicalRepo} `),
    );
    const recorded = existsSync(lifecycleLog)
      ? new Set(
          readFileSync(lifecycleLog, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line).pid),
        )
      : new Set();
    const adapters = rows.filter(
      (row) =>
        row.command.includes(adapter) &&
        (recorded.has(row.pid) ||
          row.command.includes(join(external, "plan.json"))),
    );
    if (owners.length === 0 && adapters.length === 0) return;
    if (Date.now() >= deadline)
      throw new Error(
        `QA processes did not exit; retained ${temp}; owners=${owners.map((r) => r.pid)}, adapters=${adapters.map((r) => r.pid)}`,
      );
    if (existsSync(runDir)) {
      for (const id of readdirSync(runDir)) {
        if (
          !owners.some((row) =>
            row.command.endsWith(` ${canonicalRepo} ${id}`),
          ) ||
          cancelled.has(id)
        )
          continue;
        cancelled.add(id);
        spawnSync(node, [cli, "cancel", id], {
          cwd: repo,
          env: environment,
          encoding: "utf8",
          timeout: 5_000,
        });
      }
    }
    await delay(100);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runScenario(process.execPath, process.argv[2] ?? root);
}
