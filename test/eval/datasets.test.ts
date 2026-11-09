import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  deriveDatasets,
  splitForCluster,
} from "../../eval/datasets/derive.mjs";

const SWE = "extracted/swe-refactor-v1/SWE-Refactor/pure_refactoring_data.json";
const SIMPLI = "extracted/simplibench-dataset/remove_duplication";
const REVISION = "a".repeat(40);

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "degreaser-datasets-"));
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
  return { root, sourceRoot, put };
}

function refactoring(overrides: Record<string, unknown> = {}) {
  return {
    type: "Inline Method",
    projectName: "one-project",
    commitId: REVISION,
    uniqueId: "one-method",
    isPureRefactoring: true,
    filePathBefore: "src/A.java",
    sourceCodeBeforeForWhole:
      "class A {\n  int field;\n\n  void redundant() {\n    field = 0;\n  }\n}\n",
    sourceCodeBeforeRefactoring: "void redundant() {\n    field = 0;\n  }",
    // Deliberately misleading after-side ranges, not the target's location.
    diffLocations: [{ filePath: "src/A.java", startLine: 900, endLine: 910 }],
    ...overrides,
  };
}

function git(directory: string, ...args: string[]) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  }).trim();
}

test("derivation anchors the unique before method, not mixed-side diffLocations", async (t) => {
  const { root, sourceRoot, put } = fixture(t);
  put(SWE, [
    refactoring(),
    refactoring({ uniqueId: "other", commitId: "b".repeat(40) }),
    refactoring({ uniqueId: "unsupported", type: "toString" }),
    refactoring({
      uniqueId: "ambiguous",
      sourceCodeBeforeForWhole: "void repeated() {}\nvoid repeated() {}\n",
      sourceCodeBeforeRefactoring: "void repeated() {}",
    }),
  ]);
  const { samples } = await deriveDatasets({
    sourceRoot,
    outputDir: join(root, "out"),
    sources: ["swe-refactor"],
  });
  assert.equal(samples.length, 2);
  const sample = samples[0];
  assert.ok(sample);
  assert.deepEqual(sample.target.report, [
    {
      id: "before-method",
      path: "src/A.java",
      lines: [4, 6],
      aspects: ["unnecessary-layers", "unnecessary-complexity"],
    },
  ]);
  assert.equal(samples[1]?.split, sample.split);
  assert.equal(samples[1]?.cluster, sample.cluster);
  assert.equal(sample.labelKind, "change-proxy");
  assert.deepEqual(sample.target.preserve, []);
  assert.equal(git(sample.repo.directory, "status", "--porcelain"), "");
  assert.equal(git(sample.repo.directory, "ls-files"), "src/A.java");
  assert.equal(
    readFileSync(join(sample.repo.directory, "src/A.java"), "utf8"),
    refactoring().sourceCodeBeforeForWhole,
  );
  const receipt = JSON.parse(
    readFileSync(join(root, "out/receipt.json"), "utf8"),
  );
  assert.equal(receipt.rawCounts["swe-refactor"], 4);
  assert.equal(
    receipt.skippedByReason["swe-refactor:unsupported-refactoring-type"],
    1,
  );
  assert.equal(
    receipt.skippedByReason["swe-refactor:missing-or-ambiguous-before-snippet"],
    1,
  );
  assert.equal(receipt.sourceFiles.length, 1);
  assert.match(receipt.sourceFiles[0].sha256, /^[a-f0-9]{64}$/);
});

test("tagged fragments collapse to honest raw physical lines and never enter the repo", async (t) => {
  const { root, sourceRoot, put } = fixture(t);
  const raw = {
    idx: 1,
    cs: "void run() { a(); b(); }",
    java: "void run() { c(); }",
  };
  const tagged = {
    idx: 1,
    cs: "void run() { <original>a();</original> <original>b();</original> }",
    java: "void run() { <simplified>c();</simplified> }",
  };
  put(`${SIMPLI}/untagged/json/small/test.jsonl`, `${JSON.stringify(raw)}\n`);
  put(`${SIMPLI}/tagged/json/small/test.jsonl`, `${JSON.stringify(tagged)}\n`);
  const { samples: first } = await deriveDatasets({
    sourceRoot,
    outputDir: join(root, "one"),
    sources: ["simplibench"],
  });
  mkdirSync(join(root, "repos"));
  const { samples: second } = await deriveDatasets({
    sourceRoot,
    outputDir: join(root, "repos/two"),
    sources: ["simplibench"],
  });
  const sample = first[0];
  assert.ok(sample);
  assert.equal(sample.split, "holdout");
  assert.equal(sample.provenance.coarseLocalization, true);
  assert.deepEqual(sample.target.report, [
    { id: "original-1", path: "Before.java", lines: [1, 1] },
  ]);
  assert.deepEqual(sample.target.preserve, []);
  assert.equal(
    readFileSync(join(sample.repo.directory, "Before.java"), "utf8"),
    raw.cs,
  );
  assert.equal(git(sample.repo.directory, "ls-files"), "Before.java");
  assert.equal(
    git(sample.repo.directory, "rev-parse", "HEAD"),
    git(second[0]?.repo.directory ?? "", "rev-parse", "HEAD"),
  );
  const receipt = (path: string) =>
    JSON.parse(readFileSync(join(root, path, "receipt.json"), "utf8"));
  assert.equal(
    receipt("one").portableSamplesSha256,
    receipt("repos/two").portableSamplesSha256,
  );
  assert.equal(
    receipt("one").sourceManifestSha256,
    receipt("repos/two").sourceManifestSha256,
  );
  await assert.rejects(
    deriveDatasets({
      sourceRoot,
      outputDir: join(root, "one"),
      sources: ["simplibench"],
    }),
    /new directory/,
  );
});

test("mismatched tagged source is excluded, not approximated into a label", async (t) => {
  const { root, sourceRoot, put } = fixture(t);
  put(
    `${SIMPLI}/untagged/json/small/test.jsonl`,
    `${JSON.stringify({ idx: 1, cs: "a();", java: "b();" })}\n`,
  );
  put(
    `${SIMPLI}/tagged/json/small/test.jsonl`,
    `${JSON.stringify({ idx: 1, cs: "<original>different();</original>", java: "b();" })}\n`,
  );
  assert.deepEqual(
    (
      await deriveDatasets({
        sourceRoot,
        outputDir: join(root, "out"),
        sources: ["simplibench"],
      })
    ).samples,
    [],
  );
  const receipt = JSON.parse(
    readFileSync(join(root, "out/receipt.json"), "utf8"),
  );
  assert.equal(
    receipt.skippedByReason["simplibench:unverified-original-localization"],
    1,
  );
});

test("source traversal, Git internals, symlinks, and source-root output are rejected", async (t) => {
  const { root, sourceRoot, put } = fixture(t);
  for (const [index, path] of [
    "../escape.java",
    "/absolute.java",
    ".git/hooks/pre-commit",
    "src/.GiT/config",
    "src\\escape.java",
    "src/\0escape.java",
    ".git\u200c/hooks/pre-commit",
  ].entries()) {
    put(SWE, [refactoring({ filePathBefore: path })]);
    await assert.rejects(
      deriveDatasets({
        sourceRoot,
        outputDir: join(root, `bad-${index}`),
        sources: ["swe-refactor"],
      }),
      /Unsafe source path/,
    );
  }
  const full = join(sourceRoot, SWE);
  rmSync(full);
  writeFileSync(join(root, "outside.json"), JSON.stringify([refactoring()]));
  symlinkSync(join(root, "outside.json"), full);
  await assert.rejects(
    deriveDatasets({
      sourceRoot,
      outputDir: join(root, "symlink"),
      sources: ["swe-refactor"],
    }),
    /Symlink rejected/,
  );
  rmSync(full);
  put(SWE, [refactoring()]);
  await assert.rejects(
    deriveDatasets({
      sourceRoot,
      outputDir: join(sourceRoot, "generated"),
      sources: ["swe-refactor"],
    }),
    /outside sourceRoot/,
  );
});

test("source populations have pinned split roles and invalid source selections are rejected", async (t) => {
  const { root, sourceRoot } = fixture(t);
  assert.equal(splitForCluster("repository:degreaser-axi"), "dev");
  assert.equal(splitForCluster("population:simplibench-small-test"), "holdout");
  await assert.rejects(
    deriveDatasets({
      sourceRoot,
      outputDir: join(root, "out"),
      sources: ["unknown"],
    }),
    /Invalid dataset sources/,
  );
});

test("dataset CLI rejects unknown and missing flags before reading source data", () => {
  const cli = fileURLToPath(
    new URL("../../eval/datasets/derive.mjs", import.meta.url),
  );
  for (const args of [["derive", "--unknown"], ["derive"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /VALIDATION_ERROR/);
  }
  const help = spawnSync(process.execPath, [cli, "derive", "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--source-root/);
});
