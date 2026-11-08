import assert from "node:assert/strict";

import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";

import { join } from "node:path";

import test from "node:test";
import { fixture } from "../../../../test/utils/git-fixture.ts";
import { prepareReview } from "../../../../test/utils/input.ts";

const request = ["--scope", "worktree", "--task", "Change fixture"];

test("worktree is HEAD to final contents, not a union of staged and unstaged diffs", (t) => {
  const f = fixture(t);
  for (const path of [
    "reversed",
    "mixed",
    "deleted",
    "renamed",
    "staged",
    "unstaged",
  ])
    f.write(path, `original ${path}\n`);
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Baseline files");
  f.write("reversed", "staged mistake\n");
  f.write("mixed", "intermediate\n");
  f.write("staged", "staged final\n");
  f.git("add", ".");
  f.write("reversed", "original reversed\n");
  f.write("mixed", "final content\n");
  f.write("unstaged", "unstaged final\n");
  rmSync(join(f.root, "deleted"));
  renameSync(join(f.root, "renamed"), join(f.root, "new name Ω\n.txt"));
  f.write("new\tfile", "new content\n");
  f.write("ignored/no", "ignored content\n");
  const index = readFileSync(join(f.root, ".git/index"));
  const refs = f.git("show-ref");
  const status = f.git("status", "--porcelain=v1", "-z");
  f.git("config", "diff.external", "touch DIFF-HELPER-RAN");
  f.git("config", "color.ui", "always");
  const result = prepareReview(request, f.root);
  assert.deepEqual(
    result.paths.map((p) => [p.status, p.oldPath, p.path]),
    [
      ["D", "deleted", "deleted"],
      ["M", "mixed", "mixed"],
      ["A", null, "new\tfile"],
      ["R100", "renamed", "new name Ω\n.txt"],
      ["M", "staged", "staged"],
      ["M", "unstaged", "unstaged"],
    ],
  );
  assert.equal(f.git("show", `${result.tree}:mixed`), "final content\n");
  assert.equal(f.git("show", `${result.tree}:reversed`), "original reversed\n");
  assert.match(result.patch ?? "", /\+final content/);
  assert.doesNotMatch(
    result.patch ?? "",
    /staged mistake|intermediate|ignored content/,
  );
  assert.equal(result.patch?.includes("\u001b"), false);
  assert.equal(existsSync(join(f.root, "DIFF-HELPER-RAN")), false);
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(f.git("show-ref"), refs);
  assert.equal(f.git("status", "--porcelain=v1", "-z"), status);
  assert.equal(readFileSync(join(f.root, "mixed"), "utf8"), "final content\n");
  assert.ok(result.limitations.some((l) => l.code === "git-object-writes"));
  assert.ok(result.limitations.some((l) => l.code === "live-context"));
});

test("clean and staged-reversed worktrees are no-changes, never repository audits", (t) => {
  const f = fixture(t);
  f.write("source", "original\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Source");
  for (const staged of [false, true]) {
    if (staged) {
      f.write("source", "staged\n");
      f.git("add", "source");
      f.write("source", "original\n");
    }
    const r = prepareReview(request, f.root);
    assert.equal(r.status, "no-changes");
    assert.equal(r.scope, "worktree");
    assert.equal(r.patch, "");
    assert.deepEqual(r.paths, []);
    assert.deepEqual(r.workers, []);
    assert.equal(existsSync(join(f.root, ".degreaser")), false);
  }
});

test("unborn worktree uses an empty tree and leaves absent index and refs absent", (t) => {
  const f = fixture(t, false);
  f.write("new", "first file\n");
  const r = prepareReview(request, f.root);
  assert.equal(f.git("ls-tree", r.base ?? ""), "");
  assert.equal(f.git("show", `${r.tree}:new`), "first file\n");
  assert.deepEqual(
    r.paths.map((p) => p.path),
    [".gitignore", "new"],
  );
  assert.equal(existsSync(join(f.root, ".git/index")), false);
  assert.equal(existsSync(join(f.root, ".git/refs/heads/main")), false);
});

test("branch uses the merge-base rather than the diverged base tip and includes local work", (t) => {
  const f = fixture(t);
  const base = f.git("rev-parse", "HEAD").trim();
  f.git("checkout", "-b", "feature");
  f.write("feature", "committed feature\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Feature");
  f.git("checkout", "main");
  f.write("base-only", "not part of feature\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Diverged base");
  f.git("checkout", "feature");
  f.write("staged", "staged\n");
  f.git("add", "staged");
  f.write("feature", "committed feature\nlocal edit\n");
  f.write("untracked", "new\n");
  const r = prepareReview(
    ["--scope", "branch", "--base", "main", "--task", "Feature"],
    f.root,
  );
  assert.equal(r.base, base);
  assert.deepEqual(
    r.paths.map((p) => p.path),
    ["feature", "staged", "untracked"],
  );
  assert.match(r.patch ?? "", /\+committed feature\n\+local edit/);
  assert.doesNotMatch(r.patch ?? "", /base-only/);
  for (const badBase of ["missing", "--help", " ", "HEAD:path"]) {
    assert.throws(
      () =>
        prepareReview(
          ["--scope", "branch", "--base", badBase, "--task", "Feature"],
          f.root,
        ),
      { name: /^(Input|Axi)Error$/ },
    );
  }
});

test("repository audit has explicit coverage, no patch and coordinator-owned scope-creep", (t) => {
  const f = fixture(t);
  for (const path of [
    "src/main.ts",
    "package.json",
    "dist/generated",
    "nested/node_modules/pkg/index",
    "coverage/report",
    ".degreaser/old-run",
  ])
    f.write(path, "content\n");
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      exclude: ["package.json"],
    }),
  );
  const rc = readFileSync(join(f.root, ".degreaserrc.json"));
  const r = prepareReview(
    ["--scope", "repository", "--task", "Audit source"],
    f.root,
  );
  assert.equal(r.base, null);
  assert.equal(r.patch, null);
  assert.deepEqual(
    r.paths.map((p) => p.path),
    [".gitignore", "src/main.ts"],
  );
  assert.ok(r.excludedPaths.includes("package.json"));
  assert.ok(r.excludedPaths.includes("dist/generated"));
  assert.equal(r.workers.length, 16);
  assert.equal(
    r.workers.some((a) => a.aspect === "scope-creep"),
    false,
  );
  assert.deepEqual(
    r.coordinatorResults.map((a) => [a.aspect, a.status]),
    [["scope-creep", "not-applicable"]],
  );
  assert.match(
    r.coordinatorResults[0]?.reason ?? "",
    /no feature-change scope/,
  );
  const only = prepareReview(
    ["--scope", "repository", "--task", "Audit", "--aspects", "scope-creep"],
    f.root,
  );
  assert.deepEqual(only.workers, []);
  assert.equal(only.coordinatorResults.length, 1);
  assert.equal(only.status, "ready");
  assert.deepEqual(readFileSync(join(f.root, ".degreaserrc.json")), rc);
  assert.ok(
    r.limitations.some(
      (l) => l.code === "coverage" && /context/.test(l.message),
    ),
  );
});
