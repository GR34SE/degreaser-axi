import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";

import test from "node:test";

import { args, setup } from "../utils/public-review-fixture.ts";

test("compiled public input errors and empty scopes create no runs or workers", (t) => {
  const f = setup(t);
  for (const invalid of [
    ["review"],
    ["review", "--scope", "unknown", "--task", "x"],
    ["review", "--scope", "worktree"],
    ["review", "--scope", "worktree", "--task", " "],
    ["review", "--scope", "worktree", "--task-file", "absent"],
    ["review", "--scope", "worktree", "--task", "x", "--task-file", "absent"],
    ["review", "--scope", "branch", "--task", "x"],
  ]) {
    const result = f.run(invalid);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /code: invalid-input/);
    assert.ok(!existsSync(join(f.root, ".degreaser")));
  }
  const empty = f.run(args);
  assert.equal(empty.status, 0, empty.stdout);
  assert.match(empty.stdout, /status: no-changes/);
  assert.match(empty.stdout, /scope: worktree/);
  assert.ok(!existsSync(join(f.root, ".degreaser")));
  assert.deepEqual(f.events(), []);
});

test("public scope-creep-only repository audit resolves without a worker", (t) => {
  const f = setup(t);
  f.write("source.ts", "export const value = 1;\n");
  const result = f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Audit source",
    "--aspects",
    "scope-creep",
  ]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /not-applicable/);
  assert.match(result.stdout, /no feature-change scope/);
  assert.equal(f.input().patch, null);
  assert.deepEqual(f.events(), []);
  assert.equal(readdirSync(join(f.root, ".degreaser/runs")).length, 1);
});

test("compiled worktree preserves final-content semantics, unusual paths and the user index", (t) => {
  const f = setup(t);
  for (const p of [
    "mixed",
    "reversed",
    "deleted",
    "staged",
    "unstaged",
    "renamed",
  ])
    f.write(p, `old ${p}\n`);
  f.git("add", ".");
  f.git("commit", "-m", "Base files");
  const base = f.git("rev-parse", "HEAD").trim();
  f.write("mixed", "intermediate\n");
  f.write("reversed", "mistake\n");
  f.write("staged", "staged final\n");
  f.git("add", ".");
  f.write("mixed", "final\n");
  f.write("reversed", "old reversed\n");
  f.write("unstaged", "unstaged final\n");
  rmSync(join(f.root, "deleted"));
  renameSync(join(f.root, "renamed"), join(f.root, "space Ω\nname"));
  f.write("new\tfile", "new source\n");
  f.write("ignored/no", "not assessed\n");
  f.git("config", "diff.external", "touch DIFF-EXECUTED");
  f.git("config", "color.ui", "always");
  const index = readFileSync(join(f.root, ".git/index")),
    refs = f.git("show-ref");
  const result = f.run(args);
  assert.equal(result.status, 0, result.stdout);
  const input = f.input();
  assert.equal(input.base, base);
  assert.deepEqual(
    input.paths.map((p: { path: string }) => p.path),
    ["deleted", "mixed", "new\tfile", "space Ω\nname", "staged", "unstaged"],
  );
  assert.equal(f.git("show", `${input.tree}:mixed`), "final\n");
  assert.doesNotMatch(input.patch, /intermediate|mistake|not assessed/);
  assert.ok(!input.patch.includes("\u001b"));
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(f.git("show-ref"), refs);
  assert.ok(!existsSync(join(f.root, "DIFF-EXECUTED")));
});

test("compiled branch uses merge-base, includes local work, and refuses unavailable history without starts", (t) => {
  const f = setup(t);
  const base = f.git("rev-parse", "HEAD").trim();
  f.git("checkout", "-b", "feature");
  f.write("feature", "committed\n");
  f.git("add", ".");
  f.git("commit", "-m", "Feature");
  f.git("checkout", "main");
  f.write("base-only", "base tip only\n");
  f.git("add", ".");
  f.git("commit", "-m", "Base advances");
  f.git("checkout", "feature");
  f.write("feature", "committed\nunstaged\n");
  f.write("staged", "staged\n");
  f.git("add", "staged");
  f.write("new", "new\n");
  const branch = [
    "review",
    "--scope",
    "branch",
    "--base",
    "main",
    "--task",
    "Feature",
    "--aspects",
    "low-value-comments",
  ];
  assert.equal(f.run(branch).status, 0);
  const input = f.input();
  assert.equal(input.base, base);
  assert.deepEqual(
    input.paths.map((p: { path: string }) => p.path),
    ["feature", "new", "staged"],
  );
  const count = f.events().length,
    runs = readdirSync(join(f.root, ".degreaser/runs"));
  assert.equal(
    f.run(["review", "--scope", "branch", "--base", "absent", "--task", "x"])
      .status,
    2,
  );
  f.write(
    ".git/shallow",
    `${f.git("rev-parse", "HEAD").trim()}\n${f.git("rev-parse", "main").trim()}\n`,
  );
  const missing = f.run(branch);
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /history/);
  assert.equal(f.events().length, count);
  assert.deepEqual(readdirSync(join(f.root, ".degreaser/runs")), runs);
  assert.ok(!existsSync(join(f.root, ".git/FETCH_HEAD")));
});

test("public unborn worktree works, while unborn and conflicted branches refuse before admission", (t) => {
  const unborn = setup(t, false);
  unborn.write("source", "new\n");
  assert.equal(
    unborn.run(["review", "--scope", "branch", "--base", "main", "--task", "x"])
      .status,
    2,
  );
  assert.deepEqual(unborn.events(), []);
  assert.equal(unborn.run(args).status, 0);
  const input = unborn.input();
  assert.equal(unborn.git("ls-tree", input.base), "");
  assert.equal(unborn.git("show", `${input.tree}:source`), "new\n");
  assert.ok(!existsSync(join(unborn.root, ".git/index")));
  const f = setup(t);
  f.write("conflict", "base\n");
  f.git("add", ".");
  f.git("commit", "-m", "Base");
  f.git("checkout", "-b", "side");
  f.write("conflict", "side\n");
  f.git("commit", "-am", "Side");
  f.git("checkout", "main");
  f.write("conflict", "main\n");
  f.git("commit", "-am", "Main");
  assert.equal(
    spawnSync("git", ["merge", "--no-edit", "side"], { cwd: f.root }).status,
    1,
  );
  assert.equal(
    f.run(["review", "--scope", "branch", "--base", "side", "--task", "Merge"])
      .status,
    2,
  );
  assert.ok(!existsSync(join(f.root, ".degreaser")));
  assert.deepEqual(f.events(), []);
});

test("compiled clean, staged-reversed and reverted-branch scopes never start reviewers", (t) => {
  const f = setup(t);
  f.write("source", "original\n");
  f.git("add", ".");
  f.git("commit", "-m", "Base");
  f.write("source", "staged\n");
  f.git("add", "source");
  f.write("source", "original\n");
  assert.match(f.run(args).stdout, /status: no-changes/);
  f.git("add", "source");
  f.git("checkout", "-b", "feature");
  f.write("temporary", "change\n");
  f.git("add", ".");
  f.git("commit", "-m", "Change");
  f.git("revert", "--no-edit", "HEAD");
  const result = f.run([
    "review",
    "--scope",
    "branch",
    "--base",
    "main",
    "--task",
    "Reverted feature",
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status: no-changes/);
  assert.match(result.stdout, /scope: branch/);
  assert.deepEqual(f.events(), []);
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});

test("bounded public waiting reattaches to the same detached owner and corrupt state is never empty success", (t) => {
  const f = setup(t);
  f.write("source", "source\n");
  f.setPlan({ delayMs: 1500 });
  const started = f.run([...args, "--wait", "1"]);
  assert.equal(started.status, 3, started.stdout);
  const id = /run: (r-[\w-]+)/.exec(started.stdout)?.[1];
  assert.ok(id);
  assert.equal(f.run(["wait", id, "--wait", "10"]).status, 0);
  assert.equal(f.events().length, 1);
  const file = join(f.root, ".degreaser/runs", id, "run.json");
  const original = readFileSync(file, "utf8");
  for (const damaged of [
    "{",
    JSON.stringify({ ...JSON.parse(original), schemaVersion: 99 }),
  ]) {
    writeFileSync(file, damaged);
    const result = f.run(["report", id]);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /state-corrupt/);
    assert.ok(result.stdout.includes("run.json"));
    assert.equal(readFileSync(file, "utf8"), damaged);
  }
});

test("public storage refuses symlink redirection before writing review artifacts", (t) => {
  const f = setup(t),
    outside = setup(t);
  f.write("source", "source\n");
  const before = readdirSync(outside.root);
  symlinkSync(outside.root, join(f.root, ".degreaser"));
  const result = f.run(args);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /state-unsafe/);
  assert.deepEqual(readdirSync(outside.root), before);
  assert.deepEqual(f.events(), []);
});
