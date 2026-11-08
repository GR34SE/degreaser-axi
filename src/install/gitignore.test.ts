import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "../../test/utils/git-fixture.ts";
import { runtime } from "../../test/utils/runtime.ts";
import { ensureStateIgnored } from "./gitignore.ts";

test("adds a root rule despite local excludes and preserves the index", (t) => {
  const f = fixture(t, false);
  writeFileSync(join(f.root, ".gitignore"), "other\n");
  writeFileSync(join(f.root, ".git/info/exclude"), "/.degreaser/\n");
  f.git("add", ".gitignore");
  const index = readFileSync(join(f.root, ".git/index"));
  const result = ensureStateIgnored(runtime(), f.root);
  assert.equal(result.changed, true);
  assert.equal(result.tracked, false);
  assert.equal(
    readFileSync(join(f.root, ".gitignore"), "utf8"),
    "other\n/.degreaser/\n",
  );
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(ensureStateIgnored(runtime(), f.root).changed, false);
});

test("preserves existing shared coverage and repairs negated rules", (t) => {
  const f = fixture(t, false);
  const path = join(f.root, ".gitignore");
  for (const text of [".degreaser/\n", ".*\n", "/.degreaser/\n# comment\n"]) {
    writeFileSync(path, text);
    assert.equal(ensureStateIgnored(runtime(), f.root).changed, false);
    assert.equal(readFileSync(path, "utf8"), text);
  }
  writeFileSync(path, "/.degreaser/\n!/.degreaser/\n");
  assert.equal(ensureStateIgnored(runtime(), f.root).changed, true);
  assert.equal(
    readFileSync(path, "utf8"),
    "/.degreaser/\n!/.degreaser/\n/.degreaser/\n",
  );
});

test("creates the root ignore file and terminates an existing partial line", (t) => {
  const f = fixture(t, false);
  const path = join(f.root, ".gitignore");
  unlinkSync(path);
  assert.equal(ensureStateIgnored(runtime(), f.root).changed, true);
  assert.equal(readFileSync(path, "utf8"), "/.degreaser/\n");
  writeFileSync(path, "other");
  assert.equal(ensureStateIgnored(runtime(), f.root).changed, true);
  assert.equal(readFileSync(path, "utf8"), "other\n/.degreaser/\n");
});

test("does not rely on configured excludes outside the root ignore file", (t) => {
  const f = fixture(t, false);
  const excludes = join(f.root, "external-excludes");
  writeFileSync(excludes, "/.degreaser/\n");
  f.git("config", "core.excludesFile", excludes);
  writeFileSync(join(f.root, ".gitignore"), "");
  assert.equal(ensureStateIgnored(runtime(), f.root).changed, true);
  assert.equal(
    readFileSync(join(f.root, ".gitignore"), "utf8"),
    "/.degreaser/\n",
  );
});

test("reports tracked state without removing it from the index", (t) => {
  const f = fixture(t, false);
  mkdirSync(join(f.root, ".degreaser"));
  writeFileSync(join(f.root, ".degreaser", "state"), "data");
  f.git("add", "-f", ".degreaser/state");
  const before = f.git("ls-files", "-z");
  assert.equal(ensureStateIgnored(runtime(), f.root).tracked, true);
  assert.equal(f.git("ls-files", "-z"), before);
});

test("refuses a symlinked root ignore file without changing its target", (t) => {
  const f = fixture(t, false);
  const target = join(f.root, "target");
  writeFileSync(target, "unchanged");
  const path = join(f.root, ".gitignore");
  unlinkSync(path);
  symlinkSync(target, path);
  assert.throws(
    () => ensureStateIgnored(runtime(), f.root),
    /symlink|regular file/i,
  );
  assert.equal(readFileSync(target, "utf8"), "unchanged");
});
