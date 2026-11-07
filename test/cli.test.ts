import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const root = fileURLToPath(new URL("../", import.meta.url));
const commands = [
  "home",
  "init",
  "doctor",
  "review",
  "wait",
  "report",
  "finding",
  "resume",
  "cancel",
  "setup",
  "help",
  "version",
  "update",
];

test("help, version and strict routing work without repo, credentials or side effects", () => {
  const cwd = mkdtempSync(join(tmpdir(), "degreaser-cli-"));
  try {
    writeFileSync(
      join(cwd, ".degreaserrc.json"),
      "invalid RC must not be loaded",
    );
    const initialFiles = readdirSync(cwd);
    const run = (args: string[]) => {
      const result = spawnSync(
        process.execPath,
        [
          "--permission",
          `--allow-fs-read=${join(root, "dist")}`,
          `--allow-fs-read=${join(root, "node_modules")}`,
          `--allow-fs-read=${join(root, "package.json")}`,
          cli,
          ...args,
        ],
        {
          cwd,
          env: { HOME: cwd, PATH: "" },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.stderr, "");
      assert.deepEqual(readdirSync(cwd), initialFiles);
      return result;
    };
    for (const flag of ["--version", "-v", "-V", "version"]) {
      const result = run([flag]);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "0.1.0\n");
    }
    for (const args of [[], ["--help"], ["help"], ["home", "--help"]]) {
      const result = run(args);
      assert.equal(result.status, 0);
      for (const command of commands)
        assert.ok(result.stdout.includes(command), command);
    }
    for (const command of commands) {
      const args =
        command === "setup"
          ? ["setup", "hooks", "--help"]
          : [command, "--help"];
      const result = run(args);
      assert.equal(result.status, 0, args.join(" "));
      assert.equal(
        result.stdout.split("\n")[0],
        `command: ${command === "setup" ? "setup hooks" : command}`,
      );
    }
    const review = run(["review", "--help"]).stdout;
    for (const text of [
      "--scope",
      "--task",
      "--task-file",
      "--base",
      "--aspects",
      "--concurrency",
      "--wait",
      "480",
    ]) {
      assert.ok(review.includes(text), text);
    }
    for (const [args, name, correction] of [
      [["reviwe"], "reviwe", "review"],
      [["constructor"], "constructor", "review"],
      [["__proto__"], "__proto__", "review"],
      [["review", "--scpoe", "worktree"], "--scpoe", "--scope"],
      [["report", "--task", "hello"], "--task", "--full"],
      [["wait", "r-example", "extra"], "extra", "<run-id>"],
      [["setup", "other"], "other", "hooks"],
      [["setup", "other", "--help"], "other", "hooks"],
      [["setup", "hooks", "--scope", "worktree"], "--scope", "--harnesses"],
      [["review", "--scpoe", "--help"], "--scpoe", "--scope"],
      [["report", "--full", "one", "extra", "--help"], "extra", "report"],
    ] as const) {
      const result = run([...args]);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stdout, /code: VALIDATION_ERROR/);
      assert.ok(result.stdout.includes(name), result.stdout);
      assert.ok(result.stdout.includes(correction), result.stdout);
    }
    const update = run(["update", "--now"]);
    assert.equal(update.status, 2);
    assert.match(update.stdout, /Unknown update option: --now/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("bare version stays close to the Node startup floor", () => {
  const duration = (args: string[]) => {
    const start = performance.now();
    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return performance.now() - start;
  };
  const floor: number[] = [];
  const version: number[] = [];
  for (let i = 0; i < 7; i++) {
    floor.push(duration(["-e", "console.log(1)"]));
    version.push(duration([cli, "--version"]));
  }
  floor.sort((a, b) => a - b);
  version.sort((a, b) => a - b);
  assert.ok(
    (version[3] ?? Infinity) < (floor[3] ?? 0) * 4,
    JSON.stringify({ floor, version }),
  );
});

test("setup errors name the command that resolves them", (t) => {
  const outside = mkdtempSync(join(tmpdir(), "degreaser-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const run = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: outside },
    });
  const notRepo = run(outside, ["report"]);
  assert.equal(notRepo.status, 2, notRepo.stdout);
  assert.match(notRepo.stdout, /Not inside a Git repository/);
  spawnSync("git", ["init", "-q"], { cwd: outside });
  const unconfigured = run(outside, [
    "review",
    "--scope",
    "worktree",
    "--task",
    "Check",
  ]);
  assert.equal(unconfigured.status, 2, unconfigured.stdout);
  assert.match(unconfigured.stdout, /help\[1\]: degreaser-axi init/);
});
