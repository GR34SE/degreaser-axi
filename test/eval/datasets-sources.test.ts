import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
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
import {
  commentLabels,
  stripLocalization,
} from "../../eval/datasets/anchors.mjs";
import { deriveDatasets } from "../../eval/datasets/derive.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function fixture(t: test.TestContext) {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "degreaser-dataset-sources-"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "source");
  mkdirSync(sourceRoot);
  const put = (path: string, value: unknown) => {
    const full = join(sourceRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(
      full,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const pr = (
    name: string,
    options: { merged?: boolean; title?: string; files?: unknown[] } = {},
  ) => {
    const files = options.files ?? [
      { filename: "A.java", status: "modified" },
      { filename: "README.md", status: "modified" },
    ];
    put(`pull-requests/${name}/raw/metadata.json`, {
      merged: options.merged ?? true,
      title: options.title ?? "Remove unnecessary wrapper",
      number: 1,
      changed_files: files.length,
      base: { sha: BASE, repo: { full_name: "org/project" } },
      head: { sha: HEAD },
    });
    put(`pull-requests/${name}/raw/files-page-1.json`, files);
    put(
      `extracted/${name}-base/project-${BASE}/A.java`,
      "class A {\n  void helper() {}\n  void run() { helper(); }\n}\n",
    );
    put(
      `extracted/${name}-head/project-${HEAD}/A.java`,
      "class A {\n  void run() {}\n}\n",
    );
    put(`extracted/${name}-base/project-${BASE}/README.md`, "before\n");
    put(`extracted/${name}-head/project-${HEAD}/README.md`, "after\n");
  };
  return { root, sourceRoot, put, pr };
}

test("cleanup API snapshot labels are explicit weak proxies; broad, restorative and unmerged PRs are excluded", async (t) => {
  const { root, sourceRoot, put, pr } = fixture(t);
  pr("merged");
  put(
    `extracted/merged-base/project-${BASE}/.gitattributes`,
    "*.java diff=external\n",
  );
  pr("closed", { merged: false });
  pr("restore", { title: "fix: restore exported symbols" });
  pr("broad", {
    files: Array.from({ length: 101 }, (_, index) => ({
      filename: `src/Changed${index}.java`,
      status: "modified",
    })),
  });
  const {
    samples: [sample],
  } = await deriveDatasets({
    sourceRoot,
    outputDir: join(root, "out"),
    sources: ["cleanup-pr"],
  });
  assert.ok(sample);
  assert.equal(sample.id, "cleanup-pr/merged");
  assert.equal(sample.labelKind, "change-proxy");
  assert.equal(sample.review.scope, "repository");
  assert.equal(sample.review.base, undefined);
  assert.deepEqual(sample.review.paths, ["A.java"]);
  assert.deepEqual(sample.target.report, [
    { id: "A.java:1", path: "A.java", lines: [2, 3] },
  ]);
  assert.deepEqual(sample.target.preserve, []);
  assert.equal(
    existsSync(join(sample.repo.directory, ".gitattributes")),
    false,
  );
  assert.equal(sample.provenance.revision, BASE);
  assert.equal(sample.provenance.headRevision, HEAD);
  assert.match(String(sample.provenance.comparison), /merge-base NOT verified/);
  assert.equal(
    readFileSync(join(sample.repo.directory, "A.java"), "utf8"),
    "class A {\n  void helper() {}\n  void run() { helper(); }\n}\n",
  );
  assert.equal(
    execFileSync(
      "git",
      ["-C", sample.repo.directory, "status", "--porcelain"],
      { encoding: "utf8" },
    ),
    "",
  );
  const receipt = JSON.parse(
    readFileSync(join(root, "out/receipt.json"), "utf8"),
  );
  assert.equal(receipt.rawCounts["cleanup-pr"], 4);
  assert.equal(receipt.rawCounts["cleanup-pr-merged"], 3);
  assert.equal(receipt.skippedByReason["cleanup-pr:not-merged"], 1);
  assert.equal(
    receipt.skippedByReason["cleanup-pr:broad-change-over-100-files"],
    1,
  );
  assert.equal(
    receipt.skippedByReason["cleanup-pr:restoration-not-cleanup-direction"],
    1,
  );
  assert.equal(
    receipt.skippedByReason["cleanup-pr-file:non-production-source"],
    1,
  );
  assert.equal(
    receipt.skippedByReason[
      "merged:omitted-unsafe-control-binary-or-large-context"
    ],
    1,
  );
});

test("snapshot Git internals are rejected before materialization, and snapshot SHA directories are checked", async (t) => {
  const { root, sourceRoot, put, pr } = fixture(t);
  pr("hostile");
  put(
    `extracted/hostile-base/project-${BASE}/.git/hooks/pre-commit`,
    "#!/bin/sh\nexit 99\n",
  );
  await assert.rejects(
    deriveDatasets({
      sourceRoot,
      outputDir: join(root, "hostile-out"),
      sources: ["cleanup-pr"],
    }),
    /Unsafe source path/,
  );
  assert.equal(existsSync(join(root, "hostile-out/repos")), false);
  rmSync(
    join(sourceRoot, "extracted/hostile-base", `project-${BASE}`, ".git"),
    { recursive: true },
  );
  put("pull-requests/hostile/raw/metadata.json", {
    merged: true,
    title: "cleanup",
    number: 1,
    changed_files: 2,
    base: { sha: "c".repeat(40), repo: { full_name: "org/project" } },
    head: { sha: HEAD },
  });
  await assert.rejects(
    deriveDatasets({
      sourceRoot,
      outputDir: join(root, "wrong-sha"),
      sources: ["cleanup-pr"],
    }),
    /does not match pinned base revision/,
  );
});

test("self localization counts deleted comment blocks and keeps untouched surviving comments as PRESERVE", () => {
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
  assert.deepEqual(labels.forbidden, []);
  assert.deepEqual(commentLabels(after, after, [[1, 5]], "src/a.ts"), {
    report: [],
    preserve: [],
    forbidden: [],
  });
  assert.deepEqual(
    commentLabels(before, after, [[3, 3]], "src/a.ts").report,
    [],
  );
});

test("multiline localization preserves exact stripped-source line numbers and rejects malformed tags", () => {
  assert.deepEqual(
    stripLocalization(
      "void run() {\n<original>  a();\n  b();</original>\n}\n",
      "void run() {\n  a();\n  b();\n}\n",
    ),
    [[2, 3]],
  );
  assert.equal(stripLocalization("<original>a();", "a();"), null);
  assert.equal(stripLocalization("</original>a();", "a();"), null);
  assert.equal(
    stripLocalization("<original><original>a();</original></original>", "a();"),
    null,
  );
});
