import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import test from "node:test";
import { fixture } from "../../../../test/utils/git-fixture.ts";
import { prepareReview } from "../../../../test/utils/input.ts";

const request = ["--scope", "worktree", "--task", "Change fixture"];

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
    // An invalid diff setting fails resolution after Git has written the tree.
    if (fails) f.git("config", "diff.renames", "invalid");
    f.write("new", "untracked contents\n");
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
        message: /Git diff failed/,
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

test("scope resolution adds the tree with one recursive pathspec, not one per file", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 300; i++) f.write(`pkg/f${i}.txt`, `${i}\n`);
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Many files");
  f.write("pkg/f1.txt", "changed\n");
  f.write("pkg/new.txt", "new\n");
  const bin = mkdtempSync(join(tmpdir(), "degreaser-gitshim-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const real = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  const log = join(bin, "add.log");
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase " $* " in *" add "*) echo "$*" >> '${log}'; esac\nexec '${real}' "$@"\n`,
    { mode: 0o755 },
  );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  t.after(() => {
    process.env.PATH = previous;
  });
  const r = prepareReview(request, f.root);
  assert.deepEqual(
    r.paths.map((p) => p.path),
    ["pkg/f1.txt", "pkg/new.txt"],
  );
  const adds = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(adds.length, 1, adds.join("\n"));
  assert.match(
    adds[0] ?? "",
    / add -A -- :\(top\)( :\(top,literal,exclude\)\.degreaser)?$/,
  );
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

test("unignored .degreaser contents are never added to the temporary tree or objects", (t) => {
  const f = fixture(t);
  f.write(".gitignore", ".degreaserrc.json\n");
  f.write("src/a.ts", "old\n");
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Base");
  f.write("src/a.ts", "new\n");
  const secret = "unique-run-state-marker-9f3a\n";
  f.write(".degreaser/runs/x/patch.diff", secret);
  const oid = spawnSync("git", ["hash-object", "--stdin"], {
    cwd: f.root,
    input: secret,
    encoding: "utf8",
  }).stdout.trim();
  const r = prepareReview(request, f.root);
  assert.deepEqual(
    r.paths.map((p) => p.path),
    ["src/a.ts"],
  );
  assert.equal(
    f.git("ls-tree", "-r", "--name-only", r.tree, "--", ".degreaser"),
    "",
  );
  const exists = spawnSync("git", ["cat-file", "-e", oid], { cwd: f.root });
  assert.notEqual(
    exists.status,
    0,
    "state file must not be written as an object",
  );
});
