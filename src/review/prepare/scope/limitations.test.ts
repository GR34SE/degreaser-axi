import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";

import { join } from "node:path";

import test from "node:test";
import { fixture } from "../../../../test/utils/git-fixture.ts";
import { prepareReview } from "../../../../test/utils/input.ts";

const request = ["--scope", "worktree", "--task", "Change fixture"];

test("binary, gitlink and clean-filter representations are disclosed without claiming content review", (t) => {
  const f = fixture(t);
  f.write("binary", Buffer.from([0, 1, 2, 3]));
  f.write(".gitattributes", "*.ptr filter=pointer\n");
  f.git("config", "filter.pointer.clean", "printf 'pointer-only\\n'");
  f.write("file.ptr", "actual live contents\n");
  const child = fixture(t);
  f.git(
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    child.root,
    "module",
  );
  const r = prepareReview(request, f.root);
  assert.equal(r.paths.find((p) => p.path === "binary")?.binary, true);
  assert.equal(r.paths.find((p) => p.path === "module")?.newMode, "160000");
  assert.equal(f.git("show", `${r.tree}:file.ptr`), "pointer-only\n");
  assert.equal(
    readFileSync(join(f.root, "file.ptr"), "utf8"),
    "actual live contents\n",
  );
  for (const code of ["binary", "gitlink", "clean-filter"])
    assert.ok(
      r.limitations.some((l) => l.code === code),
      code,
    );
  const audit = prepareReview(
    ["--scope", "repository", "--task", "Audit"],
    f.root,
  );
  assert.equal(audit.paths.find((p) => p.path === "binary")?.binary, true);
});

test("conflicted, unborn and unavailable branch history fail without repairing Git", (t) => {
  const unborn = fixture(t, false);
  assert.throws(
    () =>
      prepareReview(
        ["--scope", "branch", "--base", "main", "--task", "Feature"],
        unborn.root,
      ),
    /HEAD/,
  );
  const f = fixture(t);
  f.write("conflict", "base\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Common");
  f.git("checkout", "-b", "side");
  f.write("conflict", "side\n");
  f.git("commit", "--no-gpg-sign", "-am", "Side");
  const side = f.git("rev-parse", "HEAD").trim();
  f.git("checkout", "main");
  f.write("conflict", "main\n");
  f.git("commit", "--no-gpg-sign", "-am", "Main");
  const merge = spawnSync(
    "git",
    ["merge", "--no-edit", "--no-gpg-sign", "side"],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(merge.status, 1);
  const index = readFileSync(join(f.root, ".git/index"));
  for (const args of [
    request,
    ["--scope", "branch", "--base", "side", "--task", "Merge"],
  ]) {
    assert.throws(() => prepareReview(args, f.root), /unmerged/);
  }
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  f.git("merge", "--abort");
  // This is real Git's shallow-history boundary, not a mocked merge-base.
  f.write(".git/shallow", `${f.git("rev-parse", "HEAD").trim()}\n${side}\n`);
  assert.throws(
    () =>
      prepareReview(
        ["--scope", "branch", "--base", "side", "--task", "Feature"],
        f.root,
      ),
    /history/,
  );
  assert.equal(existsSync(join(f.root, ".git/FETCH_HEAD")), false);
  assert.equal(existsSync(join(f.root, ".degreaser")), false);
});

test("a reverted branch and excluded-only change retain explicit no-changes coverage", (t) => {
  const f = fixture(t);
  f.git("checkout", "-b", "feature");
  f.write("feature", "temporary\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Feature");
  f.git("revert", "--no-edit", "--no-gpg-sign", "HEAD");
  const branch = prepareReview(
    ["--scope", "branch", "--base", "main", "--task", "Reverted feature"],
    f.root,
  );
  assert.equal(branch.status, "no-changes");
  assert.equal(branch.scope, "branch");
  assert.deepEqual(branch.workers, []);
  f.write("excluded", "private source\n");
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      exclude: ["excluded"],
    }),
  );
  const result = prepareReview(request, f.root);
  assert.equal(result.status, "no-changes");
  assert.deepEqual(result.excludedPaths, ["excluded"]);
  assert.equal(result.patch, "");
});

test("literal exclusion directories cannot inject pathspecs and renames crossing coverage become additions", (t) => {
  const f = fixture(t);
  f.write("hidden/original", "same contents\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Old path");
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      exclude: ["hidden"],
    }),
  );
  renameSync(join(f.root, "hidden/original"), join(f.root, "-new :file\n"));
  f.write("hidden/another", "not assessed\n");
  f.write("build/output", "generated\n");
  const r = prepareReview(request, f.root);
  assert.deepEqual(
    r.paths.map((p) => [p.status, p.path]),
    [["A", "-new :file\n"]],
  );
  assert.match(r.patch ?? "", /\+same contents/);
  assert.doesNotMatch(r.patch ?? "", /not assessed|generated/);
});

test("non-UTF-8 file contents are omitted like binary while other files stay covered", (t) => {
  const f = fixture(t);
  f.write("legacy", Buffer.from("caf\xe9\n", "latin1"));
  f.write("a-text", "old\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Base");
  f.write("legacy", Buffer.from("na\xefve\n", "latin1"));
  f.write("a-text", "new\n");
  f.write("z-latin", Buffer.from([0xe9, 0x0a]));
  const r = prepareReview(request, f.root);
  assert.equal(r.status, "ready");
  assert.deepEqual(
    r.paths.map((p) => [p.path, p.binary]),
    [
      ["a-text", false],
      ["legacy", true],
      ["z-latin", true],
    ],
  );
  assert.match(r.patch ?? "", /\+new/);
  assert.match(r.patch ?? "", /Binary files a\/legacy and b\/legacy differ/);
  assert.doesNotMatch(r.patch ?? "", /�|caf|na.ve/);
  assert.deepEqual(r.limitations.find((l) => l.code === "non-utf8")?.paths, [
    "legacy",
    "z-latin",
  ]);
  assert.equal(
    r.limitations.some((l) => l.code === "binary"),
    false,
  );
});

test("a file-to-symlink type change does not break non-UTF-8 omission", (t) => {
  const f = fixture(t);
  f.write("link", "regular file\n");
  f.write("legacy", Buffer.from("caf\xe9\n", "latin1"));
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Base");
  rmSync(join(f.root, "link"));
  symlinkSync("target", join(f.root, "link"));
  f.write("legacy", Buffer.from("na\xefve\n", "latin1"));
  const r = prepareReview(request, f.root);
  assert.equal(r.status, "ready");
  assert.deepEqual(
    r.paths.map((p) => [p.status, p.path, p.binary]),
    [
      ["M", "legacy", true],
      ["T", "link", false],
    ],
  );
  assert.match(r.patch ?? "", /Binary files a\/legacy and b\/legacy differ/);
  assert.match(r.patch ?? "", /\+target/);
  assert.deepEqual(r.limitations.find((l) => l.code === "non-utf8")?.paths, [
    "legacy",
  ]);
});

test("built-in exclusions cover generated directories, not files with those names", (t) => {
  const f = fixture(t);
  for (const path of [
    "scripts/build",
    "internal/dist",
    "docs/coverage",
    "build/out.js",
    "a/dist/b/c.js",
    "node_modules/x/index.js",
  ])
    f.write(path, "content\n");
  const r = prepareReview(request, f.root);
  assert.deepEqual(
    r.paths.map((p) => p.path),
    ["docs/coverage", "internal/dist", "scripts/build"],
  );
  assert.deepEqual([...r.excludedPaths].sort(), [
    "a/dist/b/c.js",
    "build/out.js",
    "node_modules/x/index.js",
  ]);
});

test("--path on a clean tree stays no-changes while a typo over real changes is rejected", (t) => {
  const f = fixture(t);
  f.write("src/a.ts", "old\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Base");
  const clean = prepareReview([...request, "--path", "src"], f.root);
  assert.equal(clean.status, "no-changes");
  f.write("src/a.ts", "new\n");
  assert.throws(() => prepareReview([...request, "--path", "docs"], f.root), {
    name: "InputError",
    message: /--path docs/,
  });
});
