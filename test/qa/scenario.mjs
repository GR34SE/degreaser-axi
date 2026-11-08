import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupRuns } from "./cleanup.mjs";
import { scenarioFixture } from "./fixture.mjs";
import { checkOnboarding } from "./onboarding.mjs";

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
  const cli = join(packageRoot, "dist/main.js");
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
    QA_PROFILE: join(
      packageRoot,
      "dist/modules/harness/common/build-profile.js",
    ),
    QA_ADAPTER: join(external, "review-acp.mjs"),
    SYNTHETIC_PLAN: plan,
    NODE_OPTIONS: `--import=${join(external, "register.mjs")}`,
  };
  const commands = [];
  try {
    const { git, run, setPlan, currentRun, finding, decode } = scenarioFixture({
      repo,
      external,
      home,
      plan,
      log,
      lifecycleLog,
      node,
      cli,
      environment,
      commands,
      packageRoot,
      runDir,
    });
    git("init", "-q");
    writeFileSync(join(repo, "source.ts"), "export const value = 1;\n");
    git("add", "source.ts");
    git("commit", "-qm", "Initial source");
    setPlan();
    checkOnboarding({ repo, home, run });
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

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runScenario(process.execPath, process.argv[2] ?? root);
}
