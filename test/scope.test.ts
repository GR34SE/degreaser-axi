import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { prepareReview } from "../src/input.ts";
import { fixture } from "./git-fixture.ts";

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
      { name: "InputError" },
    );
  }
});

test("repository audit has explicit coverage, no patch and coordinator-owned A08", (t) => {
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
  assert.equal(r.workers.length, 15);
  assert.equal(
    r.workers.some((a) => a.aspect === "A08"),
    false,
  );
  assert.deepEqual(
    r.coordinatorResults.map((a) => [a.aspect, a.status]),
    [["A08", "not-applicable"]],
  );
  assert.match(
    r.coordinatorResults[0]?.reason ?? "",
    /no feature-change scope/,
  );
  const only = prepareReview(
    ["--scope", "repository", "--task", "Audit", "--aspects", "A08"],
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

test("assume-unchanged, skip-worktree and split index do not hide final contents or alter the user index", (t) => {
  const f = fixture(t);
  f.write("assumed", "old\n");
  f.write("skipped", "old\n");
  f.write(".degreaser/tracked", "must not enter tree\n");
  f.git("add", "assumed", "skipped");
  f.git("add", "-f", ".degreaser/tracked");
  f.git("commit", "--no-gpg-sign", "-m", "Index flags");
  f.git("update-index", "--assume-unchanged", "assumed");
  f.git("update-index", "--skip-worktree", "skipped");
  f.git("update-index", "--split-index");
  f.write("assumed", "actual assumed\n");
  f.write("skipped", "actual skipped\n");
  const index = readFileSync(join(f.root, ".git/index"));
  const entries = f.git("ls-files", "-v", "-s");
  const r = prepareReview(request, f.root);
  assert.deepEqual(
    r.paths.map((p) => p.path),
    ["assumed", "skipped"],
  );
  assert.equal(f.git("show", `${r.tree}:assumed`), "actual assumed\n");
  assert.equal(f.git("show", `${r.tree}:skipped`), "actual skipped\n");
  assert.equal(
    f.git("ls-tree", "-r", "--name-only", r.tree, "--", ".degreaser"),
    "",
  );
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(f.git("ls-files", "-v", "-s"), entries);
  assert.equal(
    readFileSync(join(f.root, ".degreaser/tracked"), "utf8"),
    "must not enter tree\n",
  );
});

for (const split of [false, true]) {
  test(`racily clean ${split ? "split" : "ordinary"} index retains same-size final edits`, (t) => {
    const f = fixture(t);
    f.git("config", "core.trustctime", "false");
    f.git("config", "core.checkStat", "minimal");
    f.git("config", "core.splitIndex", String(split));
    f.git("config", "splitIndex.sharedIndexExpire", "now");
    const timestamp = 1_600_000_000;
    const paths = ["assumed", "skipped", "source"];
    for (const path of paths) {
      f.write(path, "old\n");
      utimesSync(join(f.root, path), timestamp, timestamp);
    }
    f.write(".degreaser/tracked", "excluded state\n");
    f.git("add", ...paths);
    f.git("add", "-f", ".degreaser/tracked");
    f.git("commit", "--no-gpg-sign", "-m", "Racy index baseline");
    f.git("update-index", "--assume-unchanged", "assumed");
    f.git("update-index", "--skip-worktree", "skipped");
    if (split) f.git("update-index", "--split-index");
    const indexPath = join(f.root, ".git/index");
    utimesSync(indexPath, timestamp, timestamp);

    for (const path of paths) {
      f.write(path, "new\n");
      utimesSync(join(f.root, path), timestamp, timestamp);
      assert.equal(
        statSync(join(f.root, path), { bigint: true }).mtimeNs,
        BigInt(timestamp) * 1_000_000_000n,
      );
      assert.equal(statSync(join(f.root, path)).size, 4);
      const cached = f.git("ls-files", "--debug", "--", path);
      assert.match(cached, new RegExp(`mtime: ${timestamp}:0\\n`));
      assert.match(cached, /size: 4\s/);
    }
    const indexTime = statSync(indexPath, { bigint: true }).mtimeNs;
    assert.equal(indexTime, BigInt(timestamp) * 1_000_000_000n);
    assert.ok(indexTime < BigInt(Date.now()) * 1_000_000n);
    const sharedFiles = () =>
      readdirSync(join(f.root, ".git"))
        .filter((name) => name.startsWith("sharedindex."))
        .sort()
        .map((name) => [name, readFileSync(join(f.root, ".git", name))]);
    const shared = sharedFiles();
    assert.equal(shared.length > 0, split);
    assert.equal(
      f.git("rev-parse", "--shared-index-path").trim() !== "",
      split,
    );
    const index = readFileSync(indexPath);
    const entries = f.git("ls-files", "-v", "--stage", "-z");
    const refs = f.git("show-ref");
    const config = readFileSync(join(f.root, ".git/config"));
    const expectedBlob = f.git("hash-object", "--no-filters", "source").trim();
    assert.notEqual(expectedBlob, f.git("rev-parse", "HEAD:source").trim());
    // The real index still detects the edit without refreshing its stat cache.
    const oracle = f.git(
      "--no-optional-locks",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      "source",
    );
    assert.match(oracle, /-old\n\+new\n/);
    assert.deepEqual(readFileSync(indexPath), index);
    assert.equal(statSync(indexPath, { bigint: true }).mtimeNs, indexTime);

    const result = prepareReview(request, f.root);
    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.paths.map((p) => [p.path, p.newOid]),
      paths.map((path) => [path, expectedBlob]),
    );
    assert.equal(result.patch?.match(/-old\n\+new\n/g)?.length, paths.length);
    for (const path of paths) {
      assert.equal(f.git("show", `${result.tree}:${path}`), "new\n");
      assert.equal(readFileSync(join(f.root, path), "utf8"), "new\n");
      assert.equal(
        statSync(join(f.root, path), { bigint: true }).mtimeNs,
        indexTime,
      );
    }
    assert.equal(
      f.git("ls-tree", "-r", "--name-only", result.tree, "--", ".degreaser"),
      "",
    );
    assert.deepEqual(readFileSync(indexPath), index);
    assert.equal(statSync(indexPath, { bigint: true }).mtimeNs, indexTime);
    assert.equal(f.git("ls-files", "-v", "--stage", "-z"), entries);
    assert.equal(f.git("show-ref"), refs);
    assert.deepEqual(readFileSync(join(f.root, ".git/config")), config);
    assert.deepEqual(sharedFiles(), shared);
    assert.equal(
      readFileSync(join(f.root, ".degreaser/tracked"), "utf8"),
      "excluded state\n",
    );
    assert.equal(existsSync(join(f.root, ".git/index.lock")), false);
  });
}

for (const fails of [false, true]) {
  test(`configured split index preserves shared files and user state on ${fails ? "failure" : "success"}`, (t) => {
    const f = fixture(t);
    f.write("source", "original\n");
    f.git("add", ".");
    f.git("commit", "--no-gpg-sign", "-m", "Split index baseline");
    f.write("source", "staged\n");
    f.git("add", "source");
    f.git("config", "core.splitIndex", "true");
    f.git("config", "splitIndex.sharedIndexExpire", "now");
    f.git("update-index", "--split-index");
    f.write("source", "final contents\n");
    // Invalid patch text fails resolution after Git has written the tree.
    f.write("new", fails ? Buffer.from([0xe9, 0x0a]) : "untracked contents\n");
    const sharedFiles = () =>
      readdirSync(join(f.root, ".git"))
        .filter((name) => name.startsWith("sharedindex."))
        .sort()
        .map((name) => [name, readFileSync(join(f.root, ".git", name))]);
    const shared = sharedFiles();
    assert.ok(shared.length > 0, "fixture must have a shared index");
    const sharedPath = f.git("rev-parse", "--shared-index-path");
    assert.notEqual(sharedPath.trim(), "");
    const index = readFileSync(join(f.root, ".git/index"));
    const entries = f.git("ls-files", "--stage", "-z");
    const refs = f.git("show-ref");
    const files = [
      ".git/config",
      ".gitignore",
      ".degreaserrc.json",
      "source",
      "new",
    ];
    const contents = files.map((path) => readFileSync(join(f.root, path)));

    if (fails) {
      assert.throws(() => prepareReview(request, f.root), {
        name: "InputError",
        message: /non-UTF-8/,
      });
    } else {
      const result = prepareReview(request, f.root);
      assert.equal(result.status, "ready");
      assert.deepEqual(
        result.paths.map((p) => p.path),
        ["new", "source"],
      );
      assert.equal(f.git("show", `${result.tree}:source`), "final contents\n");
      assert.equal(f.git("show", `${result.tree}:new`), "untracked contents\n");
      assert.ok(result.limitations.some((l) => l.code === "git-object-writes"));
    }

    const after = sharedFiles();
    assert.deepEqual(
      after.map(([name]) => name),
      shared.map(([name]) => name),
      "no new or removed shared indexes",
    );
    assert.deepEqual(after, shared, "shared index bytes are unchanged");
    assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
    assert.equal(f.git("ls-files", "--stage", "-z"), entries);
    assert.equal(f.git("show-ref"), refs);
    assert.equal(f.git("rev-parse", "--shared-index-path"), sharedPath);
    assert.equal(f.git("config", "--bool", "core.splitIndex").trim(), "true");
    assert.deepEqual(
      files.map((path) => readFileSync(join(f.root, path))),
      contents,
    );
    assert.equal(existsSync(join(f.root, ".git/index.lock")), false);
    assert.equal(existsSync(join(f.root, ".degreaser")), false);
  });
}

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

test("non-UTF-8 source is refused rather than persisting replacement characters", (t) => {
  const f = fixture(t);
  f.write("legacy", Buffer.from([0xe9, 0x0a]));
  assert.throws(() => prepareReview(request, f.root), /UTF-8/);
});

test("Git hooks, filesystem monitors and text converters cannot run during resolution", (t) => {
  const f = fixture(t);
  f.write("source", "old\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Source");
  f.write("source", "new\n");
  f.write(".gitattributes", "source diff=sentinel\n");
  f.write(".git/hooks/post-index-change", "#!/bin/sh\ntouch .git/hook-ran\n");
  f.write(".git/monitor", "#!/bin/sh\ntouch .git/monitor-ran\n");
  chmodSync(join(f.root, ".git/hooks/post-index-change"), 0o755);
  chmodSync(join(f.root, ".git/monitor"), 0o755);
  f.git("config", "core.fsmonitor", join(f.root, ".git/monitor"));
  f.git("config", "diff.sentinel.textconv", "touch .git/textconv-ran");
  const input = prepareReview(request, f.root);
  assert.match(input.patch ?? "", /\+new/);
  for (const marker of ["hook-ran", "monitor-ran", "textconv-ran"])
    assert.equal(existsSync(join(f.root, ".git", marker)), false, marker);
});
