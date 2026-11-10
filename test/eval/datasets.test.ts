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
import { commentLabels } from "../../eval/datasets/comments.mjs";
import { deriveDatasets } from "../../eval/datasets/self.mjs";

type Sample = ReturnType<typeof deriveDatasets>[number];
type Label = { id: string; path: string; lines: number[] };

const CLI = fileURLToPath(new URL("../../eval/cli.mjs", import.meta.url));
const FIXTURES = "test/live/support/comment-fixtures.ts";

function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

function commit(repo: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, "add", "-A");
  git(
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
  return git(repo, "rev-parse", "HEAD");
}

function tempRepo(t: test.TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-self-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet");
  commit(repo, { "README.md": "root\n" });
  return { root, repo };
}

function derive(t: test.TestContext) {
  const { root, repo } = tempRepo(t);
  const before = commit(repo, {
    "src/a/edit.ts":
      "// Gets the value.\nexport const a = 1;\n// Invariant: retries must keep caller identity.\nexport const b = 2;\n// Edited later.\nexport const c = 3;\n",
    "src/b/untouched.ts":
      "// Boundary: input is untrusted here.\nexport const d = 4;\n",
    "src/c/gone.ts": "// Removed note.\nexport const e = 5;\n",
    [FIXTURES]: "// Obvious fixture comment.\nexport const f = 1;\n",
  });
  const after = commit(repo, {
    "src/a/edit.ts":
      "export const a = 1;\n// Invariant: retries must keep caller identity.\nexport const b = 2;\n// Edited differently.\nexport const c = 3;\n",
    "src/c/gone.ts": "export const e = 5;\n",
    [FIXTURES]: "export const f = 1;\n",
  });
  return deriveDatasets({ outputDir: join(root, "out"), repo, before, after });
}

const labels = (sample: Sample | undefined, kind: "report" | "preserve") =>
  sample?.target[kind].map(
    (label: Label) => `${label.path}:${label.lines.join("-")}`,
  );

test("removed comments become REPORT, kept comments outside diffs PRESERVE, fixtures neither", (t) => {
  const samples = derive(t);
  const group = (path: string) =>
    samples.find(
      (sample) =>
        sample.id === `self/comments/${path}/source-instructions/repository`,
    );
  const edit = group("src/a/edit.ts");
  assert.deepEqual(labels(edit, "report"), [
    "src/a/edit.ts:1-1",
    "src/a/edit.ts:5-5",
  ]);
  assert.deepEqual(labels(edit, "preserve"), ["src/a/edit.ts:3-3"]);
  const untouched = group("src/b/untouched.ts");
  assert.deepEqual(untouched?.review.paths, ["src/b/untouched.ts"]);
  assert.deepEqual(labels(untouched, "preserve"), ["src/b/untouched.ts:1-1"]);
  assert.deepEqual(untouched?.target.report, []);
  const gone = group("src/c/gone.ts");
  assert.deepEqual(labels(gone, "report"), ["src/c/gone.ts:1-1"]);
  assert.deepEqual(gone?.target.preserve, []);
  const paths = samples.flatMap((sample) => [
    ...sample.review.paths,
    ...sample.target.report.map((label: Label) => label.path),
    ...sample.target.preserve.map((label: Label) => label.path),
  ]);
  assert.ok(!paths.includes(FIXTURES));
});

test("the whole-repository sample has empty paths and the union of all self anchors", (t) => {
  const samples = derive(t);
  const whole = samples.filter((sample) => sample.family === "self-whole");
  const grouped = samples.filter((sample) => sample.family === "self");
  assert.equal(whole.length, 1);
  assert.equal(grouped.length, 3);
  const [sample] = whole;
  assert.equal(sample?.id, "self-whole/comments/whole-repository");
  assert.equal(sample?.split, "regression");
  assert.equal(sample?.review.scope, "repository");
  assert.deepEqual(sample?.review.paths, []);
  for (const kind of ["report", "preserve"] as const)
    assert.deepEqual(
      sample?.target[kind].map((label: Label) => label.id).sort(),
      grouped
        .flatMap((s) => s.target[kind].map((label: Label) => label.id))
        .sort(),
    );
  assert.equal(sample?.target.report.length, 3);
  assert.equal(sample?.target.preserve.length, 2);
  assert.equal(git(sample?.repo.directory ?? "", "status", "--porcelain"), "");
});

test("directory groups are split between dev and regression", (t) => {
  const { root, repo } = tempRepo(t);
  const head = commit(
    repo,
    Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `src/m${i}/a.ts`,
        `// Kept note ${i}.\nexport const v = ${i};\n`,
      ]),
    ),
  );
  const groups = deriveDatasets({
    outputDir: join(root, "out"),
    repo,
    before: head,
    after: head,
  }).filter((sample) => sample.family === "self");
  assert.equal(groups.length, 20);
  const dev = groups.filter((sample) => sample.split === "dev").length;
  assert.ok(dev > 7 && dev < 20, `dev groups: ${dev}`);
  assert.ok(groups.every((s) => ["dev", "regression"].includes(s.split)));
});

test("comment blocks are grouped lexically and partially edited deletions are not REPORT", () => {
  const before = [
    'const url = "https://example.invalid";',
    "/**",
    " * Repeats the obvious.",
    " */",
    "function a() {}",
    "// First obvious statement.",
    "// Second obvious statement.",
    "const b = 1;",
    "// Required because retries must preserve caller identity.",
    "const c = 2;",
    "const text = `// not an actual comment`;",
  ].join("\n");
  const after = [
    'const url = "https://example.invalid";',
    "function a() {}",
    "// Required because retries must preserve caller identity.",
    "const c = 2;",
    "const text = `// not an actual comment`;",
  ].join("\n");
  const labels = commentLabels(before, after, [[2, 8]], "src/a.ts");
  assert.deepEqual(
    labels.report.map((label) => label.lines),
    [
      [2, 4],
      [6, 7],
    ],
  );
  assert.deepEqual(
    labels.preserve.map((label) => label.id),
    ["src/a.ts:keep:9-9"],
  );
  assert.deepEqual(
    commentLabels(before, after, [[3, 3]], "src/a.ts").report,
    [],
  );
});

test("derive fails with an actionable message when a pinned revision is absent", (t) => {
  const { root, repo } = tempRepo(t);
  assert.throws(
    () => deriveDatasets({ outputDir: join(root, "out"), repo }),
    /b4a1edec03d31b01145b923dc5b4dc0d944de0c9 is missing.*Fetch/,
  );
});

test("derive CLI requires --output, rejects removed flags and derives self from this checkout", (t) => {
  for (const args of [
    ["derive"],
    ["derive", "--output", "x", "--source", "self"],
  ]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /invalid-argument/);
  }
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-derive-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "out");
  const real = spawnSync(
    process.execPath,
    [CLI, "derive", "--output", output],
    { encoding: "utf8" },
  );
  assert.equal(real.status, 0, real.stdout + real.stderr);
  const samples = readFileSync(join(output, "samples.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    [...new Set(samples.map((sample) => sample.family))].sort(),
    ["self", "self-whole"],
  );
  for (const sample of samples) {
    assert.equal(sample.cluster, "repository:degreaser-axi");
    assert.equal(
      sample.provenance.ownerRevision,
      "d232af804ae532c4bd4bf79f56d4d854d7ef2715",
    );
    assert.ok(sample.target.report.length + sample.target.preserve.length > 0);
  }
});
