import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Sample } from "../../eval/datasets/derive.mjs";
import { deriveDatasets } from "../../eval/datasets/derive.mjs";
import { deriveRefactoring } from "../../eval/datasets/pairs.mjs";

const CLI = fileURLToPath(new URL("../../eval/cli.mjs", import.meta.url));
const FIXTURES = "test/live/support/comment-fixtures.ts";

function run(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

function put(repo: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

function commit(repo: string, files: Record<string, string>) {
  put(repo, files);
  run(repo, "add", "-A");
  run(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "c",
  );
  return run(repo, "rev-parse", "HEAD");
}

const fixtureLines = (extra: string) =>
  `// Obvious fixture comment.\nexport const f = 1;\n${extra}`;

function selfRepo(t: test.TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-self-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  run(repo, "init", "--quiet");
  commit(repo, { "README.md": "root\n" });
  const before = commit(repo, {
    "src/a/edit.ts":
      "// Gets the value.\nexport const a = 1;\n// Invariant: retries must keep caller identity.\nexport const b = 2;\n// Edited later.\nexport const c = 3;\n",
    "src/b/untouched.ts":
      "// Boundary: input is untrusted here.\nexport const d = 4;\n",
    "src/c/gone.ts": "// Removed note.\nexport const e = 5;\n",
    [FIXTURES]: fixtureLines(""),
  });
  const after = commit(repo, {
    "src/a/edit.ts":
      "export const a = 1;\n// Invariant: retries must keep caller identity.\nexport const b = 2;\n// Edited differently.\nexport const c = 3;\n",
    "src/c/gone.ts": "export const e = 5;\n",
    [FIXTURES]: "export const f = 1;\n",
  });
  return { root, repo, selfRevisions: { before, after } };
}

async function derive(t: test.TestContext, name: string) {
  const { root, repo, selfRevisions } = selfRepo(t);
  const outputDir = join(root, name);
  const result = await deriveDatasets({
    outputDir,
    selfRepo: repo,
    selfRevisions,
  });
  return { ...result, root, repo, selfRevisions };
}

const labels = (sample: Sample | undefined, kind: "report" | "preserve") =>
  sample?.target[kind].map((label) => `${label.path}:${label.lines.join("-")}`);

test("kept comments outside diffs become PRESERVE; edited, deleted and fixture comments do not", async (t) => {
  const { samples } = await derive(t, "out");
  const byId = new Map(samples.map((sample) => [sample.id, sample]));
  const edit = byId.get(
    "self/comments/src/a/edit.ts/source-instructions/repository",
  );
  assert.deepEqual(labels(edit, "preserve"), ["src/a/edit.ts:3-3"]);
  assert.deepEqual(labels(edit, "report"), [
    "src/a/edit.ts:1-1",
    "src/a/edit.ts:5-5",
  ]);
  const untouched = byId.get(
    "self/comments/src/b/untouched.ts/source-instructions/repository",
  );
  assert.deepEqual(untouched?.review.paths, ["src/b/untouched.ts"]);
  assert.deepEqual(labels(untouched, "preserve"), ["src/b/untouched.ts:1-1"]);
  assert.deepEqual(untouched?.target.report, []);
  const gone = byId.get(
    "self/comments/src/c/gone.ts/source-instructions/repository",
  );
  assert.deepEqual(gone?.target.preserve, []);
  assert.deepEqual(labels(gone, "report"), ["src/c/gone.ts:1-1"]);
  assert.ok(!samples.some((sample) => sample.review.paths.includes(FIXTURES)));
  const all = samples.flatMap((s) => [
    ...s.target.report,
    ...s.target.preserve,
  ]);
  assert.ok(!all.some((label) => label.path === FIXTURES));
});

test("the whole-repository sample has empty paths and the union of all self anchors", async (t) => {
  const { samples, receipt } = await derive(t, "out");
  const whole = samples.filter((sample) => sample.family === "self-whole");
  assert.equal(whole.length, 1);
  const [sample] = whole;
  assert.equal(sample?.id, "self-whole/comments/whole-repository");
  assert.equal(sample?.split, "regression");
  assert.equal(sample?.cluster, "repository:degreaser-axi");
  assert.equal(sample?.review.scope, "repository");
  assert.deepEqual(sample?.review.paths, []);
  const grouped = samples.filter((s) => s.family === "self");
  for (const kind of ["report", "preserve"] as const)
    assert.deepEqual(
      sample?.target[kind].map((l) => l.id).sort(),
      grouped.flatMap((s) => s.target[kind].map((l) => l.id)).sort(),
    );
  assert.equal(sample?.target.report.length, 3);
  assert.equal(sample?.target.preserve.length, 2);
  assert.deepEqual(receipt.sources, ["self"]);
  assert.deepEqual(receipt.byFamily, { self: 3, "self-whole": 1 });
});

test("self group splits are deterministic and both buckets occur", async (t) => {
  const first = await derive(t, "one");
  const second = await derive(t, "two");
  const split = (samples: Sample[]) =>
    samples.map((sample) => `${sample.id}=${sample.split}`);
  assert.deepEqual(split(first.samples), split(second.samples));
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-split-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  run(repo, "init", "--quiet");
  commit(repo, { "README.md": "root\n" });
  const files = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `src/m${i}/a.ts`,
      `// Kept note ${i}.\nexport const v = ${i};\n`,
    ]),
  );
  const head = commit(repo, files);
  const { samples } = await deriveDatasets({
    outputDir: join(root, "out"),
    selfRepo: repo,
    selfRevisions: { before: head, after: head },
  });
  const groups = samples.filter((sample) => sample.family === "self");
  assert.equal(groups.length, 20);
  const splits = new Set(groups.map((sample) => sample.split));
  assert.deepEqual([...splits].sort(), ["dev", "regression"]);
  assert.ok(groups.filter((s) => s.split === "dev").length > 7);
});

test("SWE-Refactor Move types are skipped as needing cross-file context", () => {
  for (const type of [
    "Move Method",
    "Move And Rename Method",
    "Extract And Move Method",
    "Move And Inline Method",
  ])
    assert.deepEqual(deriveRefactoring({ type }, 0), {
      reason: "needs-cross-file-context",
    });
});

test("derive CLI defaults to self without a source root and requires one for other sources", (t) => {
  const { root, repo, selfRevisions } = selfRepo(t);
  assert.ok(selfRevisions.before);
  const rejected = spawnSync(
    process.execPath,
    [CLI, "derive", "--output", join(root, "x"), "--source", "simplibench"],
    { encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /--source-root/);
  const missing = spawnSync(
    process.execPath,
    [CLI, "derive", "--output", join(root, "y"), "--self-repo", repo],
    { encoding: "utf8" },
  );
  assert.match(missing.stdout + missing.stderr, /missing from/);
  const real = spawnSync(
    process.execPath,
    [CLI, "derive", "--output", join(root, "z")],
    { encoding: "utf8" },
  );
  assert.equal(real.status, 0, real.stdout + real.stderr);
  const families = new Set(
    readFileSync(join(root, "z", "samples.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).family),
  );
  assert.deepEqual([...families].sort(), ["self", "self-whole"]);
});
