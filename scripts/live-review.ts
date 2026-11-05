import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Agent } from "../src/config.ts";
import type { Run } from "../src/storage.ts";

export async function liveReview(
  agent: Agent,
  model: string,
  initialize = false,
) {
  const cwd = await realpath(
    await mkdtemp(join(tmpdir(), "degreaser-live-review-")),
  );
  const cli = fileURLToPath(
    new URL("../dist/bin/degreaser-axi.js", import.meta.url),
  );
  const runCommand = (command: string, args: string[]) =>
    spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180_000 });
  let owner: number | undefined;
  try {
    for (const args of [
      ["init", "--initial-branch=main"],
      ["add", "."],
      ["commit", "--allow-empty", "-m", "Synthetic baseline"],
    ]) {
      assert.equal(runCommand("git", args).status, 0);
    }
    await writeFile(
      join(cwd, ".gitignore"),
      "/.degreaser/\n.degreaserrc.json\n",
    );
    if (initialize) {
      const selected = [
        "--agent",
        agent,
        "--model",
        model,
        "--harnesses",
        agent,
      ];
      for (const args of [[], selected.slice(0, 4), selected.slice(4)]) {
        const result = runCommand(process.execPath, [cli, "init", ...args]);
        assert.equal(result.status, 2, result.stdout);
        assert.match(result.stdout, /decision-required/);
        assert.ok(
          result.stdout.includes(`${agent},${model},`),
          `Missing selected native candidate ${agent}/${model}`,
        );
        await assert.rejects(readFile(join(cwd, ".degreaserrc.json")), {
          code: "ENOENT",
        });
        console.log(result.stdout);
      }
      const init = runCommand(process.execPath, [cli, "init", ...selected]);
      assert.equal(init.status, 0, init.stdout);
      console.log(init.stdout);
      const confirmed = await readFile(join(cwd, ".degreaserrc.json"), "utf8");
      assert.deepEqual(JSON.parse(confirmed), {
        schemaVersion: 1,
        agent,
        model,
      });
      const reinit = runCommand(process.execPath, [cli, "init"]);
      assert.equal(reinit.status, 2, reinit.stdout);
      assert.match(reinit.stdout, /decision-required/);
      assert.equal(
        await readFile(join(cwd, ".degreaserrc.json"), "utf8"),
        confirmed,
      );
      console.log(
        JSON.stringify({ reinitExit: 2, confirmedRcUnchanged: true }),
      );
    } else
      await writeFile(
        join(cwd, ".degreaserrc.json"),
        JSON.stringify({
          agent,
          model,
          maxRetries: 0,
          limits: { workerTimeoutSeconds: 120, runTimeoutSeconds: 150 },
        }),
      );
    await writeFile(
      join(cwd, "sum.ts"),
      "// Return the sum of two numbers.\nexport const sum = (a: number, b: number) => a + b;\n",
    );
    const review = runCommand(process.execPath, [
      cli,
      "review",
      "--scope",
      "worktree",
      "--task",
      "Add a source-level sum helper for two numbers. Do not execute code.",
      "--aspects",
      "A06",
      "--wait",
      "1",
    ]);
    assert.ok(review.status === 3 || review.status === 0, review.stdout);
    const { latestRunId: id } = JSON.parse(
      await readFile(join(cwd, ".degreaser/state.json"), "utf8"),
    );
    const path = join(cwd, ".degreaser/runs", id, "run.json");
    const initial: Run = JSON.parse(await readFile(path, "utf8"));
    owner = initial.owner?.pid;
    const waited = runCommand(process.execPath, [
      cli,
      "wait",
      id,
      "--wait",
      "160",
    ]);
    const saved: Run = JSON.parse(await readFile(path, "utf8"));
    owner = saved.owner?.pid;
    const report = runCommand(process.execPath, [cli, "report", id, "--full"]);
    console.log(
      JSON.stringify(
        {
          provenance:
            "live compiled CLI -> detached owner -> public acpx -> exact subscription model; not fixture output",
          agent,
          model,
          run: id,
          reviewExit: review.status,
          waitExit: waited.status,
          reportExit: report.status,
          ownerPid: owner,
          status: saved.status,
          tasks: saved.tasks.map((t) => ({
            assignment: t.assignment,
            status: t.status,
            result: t.result,
            rejections: t.rejections,
            attempts: t.attempts,
          })),
          report: report.stdout,
        },
        null,
        2,
      ),
    );
    assert.equal(waited.status, 0, waited.stdout);
    assert.equal(report.status, 0, report.stdout);
    assert.equal(saved.status, "completed");
    assert.equal(saved.tasks.length, 1);
    assert.deepEqual(saved.tasks[0]?.assignment, {
      aspect: "A06",
      agent,
      model,
    });
    assert.ok(saved.tasks[0]?.attempts[0]?.sessionId);
    assert.ok(saved.tasks[0]?.result);
    if (saved.tasks[0].result.findings.length) {
      const detail = runCommand(process.execPath, [
        cli,
        "finding",
        "F1",
        "--run",
        id,
      ]);
      assert.equal(detail.status, 0);
      console.log(detail.stdout);
    }
  } finally {
    let stopped = !owner;
    if (owner) {
      try {
        process.kill(owner, "SIGTERM");
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ESRCH")
        )
          process.exitCode = 1;
      }
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        try {
          process.kill(owner, 0);
        } catch (error) {
          stopped =
            error instanceof Error && "code" in error && error.code === "ESRCH";
          break;
        }
        await setTimeout(50);
      }
    }
    if (stopped) await rm(cwd, { recursive: true, force: true });
    else {
      console.error(
        "Live review cleanup could not confirm owner exit; fixture retained.",
      );
      process.exitCode = 1;
    }
  }
}
