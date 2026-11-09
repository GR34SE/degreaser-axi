import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fixture } from "../utils/git-fixture.ts";

const moduleUrl = new URL("../../eval/provider-sample.mjs", import.meta.url)
  .href;

async function setup(t: TestContext) {
  const f = fixture(t);
  f.write("module.ts", "export const before = 1;\n");
  f.git("add", "module.ts");
  f.git("commit", "--no-gpg-sign", "-m", "Source base");
  const { materialize, validateSample } = await import(moduleUrl);
  const sample = {
    id: "source/snapshot",
    aspects: ["low-value-comments"],
    repo: { directory: f.root },
    review: { scope: "worktree", task: "Update module.", paths: ["module.ts"] },
  };
  const copy = async (value: object = sample) => {
    const root = mkdtempSync(join(tmpdir(), "degreaser-eval-snapshot-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const output = await materialize(value, root, {
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      timeoutMs: 10_000,
    });
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    return { root, git, ...output };
  };
  return { ...f, sample, copy, validateSample };
}

test("materialization preserves final staged, unstaged and new source without copying private history or config", async (t) => {
  const f = await setup(t);
  f.write("module.ts", "export const staged = 2;\n");
  f.git("add", "module.ts");
  f.write("module.ts", "export const final = 3;\n");
  f.write("new.ts", "export const added = true;\n");
  f.write("eval/private.json", "PRIVATE_TARGET");
  f.write(".claude/settings.json", '{"hooks":{"untrusted":true}}');
  const index = readFileSync(join(f.root, ".git/index"));
  const first = await f.copy();
  assert.equal(
    first.git("show", "HEAD:module.ts"),
    "export const before = 1;\n",
  );
  assert.equal(
    readFileSync(join(first.root, "module.ts"), "utf8"),
    "export const final = 3;\n",
  );
  assert.deepEqual(
    first.git("diff", "--name-only", "HEAD").trim().split("\n"),
    ["module.ts"],
  );
  assert.equal(
    readFileSync(join(first.root, "new.ts"), "utf8"),
    "export const added = true;\n",
  );
  assert.equal(first.git("rev-list", "--all", "--count").trim(), "1");
  assert.equal(existsSync(join(first.root, "eval")), false);
  assert.equal(existsSync(join(first.root, ".claude")), false);
  assert.equal(existsSync(join(first.root, ".degreaserrc.json")), false);
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  const second = await f.copy();
  assert.equal(second.sampleHash, first.sampleHash);
  f.write("new.ts", "export const added = false;\n");
  assert.notEqual((await f.copy()).sampleHash, first.sampleHash);
});

test("branch materialization retains the explicit merge-base and final local work", async (t) => {
  const f = await setup(t);
  f.git("branch", "given-base");
  f.write("module.ts", "export const committed = 2;\n");
  f.git("add", "module.ts");
  f.git("commit", "--no-gpg-sign", "-m", "Branch source");
  f.write("module.ts", "export const local = 3;\n");
  const sample = {
    ...f.sample,
    review: { ...f.sample.review, scope: "branch", base: "given-base" },
  };
  const copy = await f.copy(sample);
  assert.equal(
    copy.git("show", `${copy.base}:module.ts`),
    "export const before = 1;\n",
  );
  assert.equal(
    copy.git("show", "HEAD:module.ts"),
    "export const committed = 2;\n",
  );
  assert.equal(
    readFileSync(join(copy.root, "module.ts"), "utf8"),
    "export const local = 3;\n",
  );
  assert.equal(
    copy.git("merge-base", "HEAD", copy.base),
    copy.git("rev-parse", copy.base),
  );
  assert.equal(copy.git("rev-list", "--all", "--count").trim(), "2");
});

test("materialization handles deleted sources and file-to-directory transitions", async (t) => {
  const f = await setup(t);
  rmSync(join(f.root, "module.ts"));
  f.write("module.ts/child.ts", "export const child = true;\n");
  const copy = await f.copy();
  assert.equal(
    copy.git("show", "HEAD:module.ts"),
    "export const before = 1;\n",
  );
  assert.equal(
    readFileSync(join(copy.root, "module.ts/child.ts"), "utf8"),
    "export const child = true;\n",
  );
});

test("external symlinks are rejected rather than exposing the source host", async (t) => {
  const f = await setup(t);
  symlinkSync("/etc/passwd", join(f.root, "outside.txt"));
  await assert.rejects(f.copy(), /symlinks and gitlinks are unsupported/);
  assert.throws(
    () =>
      f.validateSample({
        ...f.sample,
        aspects: ["low-value-comments", "low-value-comments"],
      }),
    /Invalid evaluation sample/,
  );
  assert.throws(
    () =>
      f.validateSample({
        ...f.sample,
        review: { ...f.sample.review, scope: "branch" },
      }),
    /explicit base/,
  );
});
