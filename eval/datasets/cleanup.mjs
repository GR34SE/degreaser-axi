import { extname, join } from "node:path";
import { oldDiffRanges } from "./anchors.mjs";
import { git, materialize, ordered, safePath, sha256 } from "./io.mjs";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".rb",
  ".swift",
  ".kt",
  ".gd",
  ".vue",
  ".svelte",
]);
const NOISY_PATH =
  /(?:^|\/)(?:tests?|__tests__|fixtures?|vendor|node_modules|dist|build|generated|migrations?)(?:\/|$)|\.(?:test|spec)\./iu;

function snapshot(reader, caseName, side, revision) {
  if (!/^[a-f0-9]{40}$/u.test(revision ?? ""))
    throw new Error("PR revision must be a full Git SHA");
  const root = `extracted/${safePath(caseName)}-${side}`;
  const entries = reader.entries(root);
  if (entries.length !== 1 || !entries[0].endsWith(`-${revision}`)) {
    throw new Error(
      `PR snapshot directory does not match pinned ${side} revision`,
    );
  }
  return reader.tree(`${root}/${entries[0]}`);
}

function contextFiles(files, source, side, skip) {
  const selected = new Map();
  for (const [path, content] of files) {
    safePath(path);
    if (
      path
        .split("/")
        .some((part) => [".gitattributes", ".gitmodules"].includes(part)) ||
      content.length > 1024 * 1024 ||
      content.includes(0)
    ) {
      skip(
        source,
        `${side}:${path}`,
        "omitted-unsafe-control-binary-or-large-context",
      );
    } else selected.set(path, content);
  }
  return selected;
}

export function loadCleanup(reader, outputDir, accept, skip, counts) {
  const cases = reader.entries("pull-requests");
  counts["cleanup-pr"] = cases.length;
  counts["cleanup-pr-merged"] = 0;
  for (const name of cases) {
    const rawRoot = `pull-requests/${safePath(name)}/raw`;
    const metadata = reader.json(`${rawRoot}/metadata.json`);
    if (metadata.merged !== true) {
      skip("cleanup-pr", name, "not-merged");
      continue;
    }
    counts["cleanup-pr-merged"]++;
    const pages = reader
      .entries(rawRoot)
      .filter((path) => /^files-page-\d+\.json$/u.test(path));
    const records = pages.flatMap((path) => reader.json(`${rawRoot}/${path}`));
    if (
      records.length !== metadata.changed_files ||
      new Set(records.map((record) => record.filename)).size !== records.length
    ) {
      throw new Error(`Incomplete or duplicated PR file pages: ${name}`);
    }
    records.forEach((record) => {
      safePath(record.filename);
      if (record.previous_filename) safePath(record.previous_filename);
    });
    // Broad migrations/fixups are not cleanup labels. These are reproducible
    // acquisition filters, not a hand assessment of every changed line.
    if (records.length > 100 || !Number.isInteger(metadata.changed_files)) {
      skip("cleanup-pr", name, "broad-change-over-100-files");
      continue;
    }
    if (/\b(?:restore|revert|rollback)\b/iu.test(metadata.title ?? "")) {
      skip("cleanup-pr", name, "restoration-not-cleanup-direction");
      continue;
    }
    const base = contextFiles(
      snapshot(reader, name, "base", metadata.base.sha),
      name,
      "base",
      skip,
    );
    const head = contextFiles(
      snapshot(reader, name, "head", metadata.head.sha),
      name,
      "head",
      skip,
    );
    const repository = metadata.base.repo.full_name.toLowerCase();
    const directory = join(
      outputDir,
      "repos",
      `pr-${sha256(name).slice(0, 20)}`,
    );
    // The synthetic parent exists only to compute a complete snapshot comparison.
    // It is never represented as the upstream merge-base or a natural branch.
    const repo = materialize(directory, head, base);
    const report = [];
    for (const record of records) {
      const path = record.previous_filename ?? record.filename;
      const reason =
        !SOURCE_EXTENSIONS.has(extname(path)) || NOISY_PATH.test(path)
          ? "non-production-source"
          : !["modified", "removed"].includes(record.status)
            ? "unsupported-added-or-renamed-file"
            : !base.has(path)
              ? "missing-text-before-snapshot"
              : null;
      if (reason) {
        skip("cleanup-pr-file", `${name}:${path}`, reason);
        continue;
      }
      const patch = git(directory, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=0",
        repo.base,
        repo.head,
        "--",
        path,
      ]).toString("utf8");
      const ranges = oldDiffRanges(patch);
      const removed = ranges.reduce(
        (sum, [start, end]) => sum + end - start + 1,
        0,
      );
      if (!removed || removed > 120) {
        skip(
          "cleanup-pr-file",
          `${name}:${path}`,
          removed ? "over-120-old-lines" : "no-old-side-change",
        );
        continue;
      }
      ranges.forEach((lines, index) => {
        report.push({ id: `${path}:${index + 1}`, path, lines });
      });
    }
    if (report.length === 0) {
      skip("cleanup-pr", name, "no-supported-old-side-change");
      continue;
    }
    // Review the API base snapshot: the head and all labels are withheld.
    const beforeDirectory = join(
      outputDir,
      "repos",
      `pr-before-${sha256(name).slice(0, 20)}`,
    );
    const beforeRepo = materialize(beforeDirectory, base);
    accept({
      id: `cleanup-pr/${name}`,
      family: "cleanup-pr",
      cluster: `repository:${repository}`,
      labelKind: "change-proxy",
      aspects: [
        "unnecessary-complexity",
        "unnecessary-layers",
        "missed-reuse",
        "low-value-comments",
        "speculative-flexibility",
        "wrong-abstraction",
        "unjustified-defense",
        "structural-erosion",
        "unidiomatic-code",
      ],
      repo: beforeRepo,
      paths: ordered(new Set(report.map((label) => label.path))),
      target: { report, preserve: [], forbidden: [] },
      provenance: {
        source: "merged-cleanup-pr",
        revision: metadata.base.sha,
        headRevision: metadata.head.sha,
        repository,
        number: metadata.number,
        comparison: "PR-API-base-head-snapshot; merge-base NOT verified",
        localization: "old-side Git diff hunks; change-proxy, not issue truth",
        context:
          "text snapshots; binary, large files and Git control files omitted",
      },
    });
  }
}
