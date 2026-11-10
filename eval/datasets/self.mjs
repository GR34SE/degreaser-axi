import { join } from "node:path";
import { commentLabels, oldDiffRanges } from "./anchors.mjs";
import { git, gitTree, materialize, ordered, sha256 } from "./io.mjs";

export const SELF_FIXTURE_FILES = new Set([
  "test/live/support/comment-fixtures.ts",
]);
const TASK =
  "Audit the selected source for low-value comments. Preserve comments that explain non-obvious constraints, invariants, security boundaries or tradeoffs.";

export function hashBucket(key) {
  return (
    Number.parseInt(sha256(`degreaser-eval-v1:${key}`).slice(0, 8), 16) % 10
  );
}

export const SELF_BEFORE = "b4a1edec03d31b01145b923dc5b4dc0d944de0c9";
export const SELF_AFTER = "d232af804ae532c4bd4bf79f56d4d854d7ef2715";

function pinned(directory, revision) {
  try {
    return git(directory, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${revision}^{commit}`,
    ])
      .toString("utf8")
      .trim();
  } catch {
    throw new Error(
      `Pinned self revision ${revision} is missing from ${directory}. Fetch the main branch there or pass --self-repo with a checkout that contains it.`,
    );
  }
}

export function loadSelf(
  directory,
  outputDir,
  accept,
  skip,
  counts,
  contrasts,
  revisions = {},
) {
  const before = pinned(directory, revisions.before ?? SELF_BEFORE);
  const after = pinned(directory, revisions.after ?? SELF_AFTER);
  const parent = git(directory, ["rev-parse", `${before}^`])
    .toString("utf8")
    .trim();
  const files = gitTree(directory, before);
  const afterFiles = gitTree(directory, after);
  const parentFiles = contrasts ? gitTree(directory, parent) : undefined;
  const digest = (tree) =>
    sha256(
      [...tree]
        .map(([path, content]) => `${path}\0${sha256(content)}`)
        .join("\n"),
    );
  const sourceTreeSha256 = digest(files);
  const groups = new Map();
  counts.self = 0;
  for (const [path, bytes] of files) {
    if (!/\.[cm]?tsx?$/u.test(path) || !afterFiles.has(path)) continue;
    if (SELF_FIXTURE_FILES.has(path)) {
      skip("self-file", path, "deliberate-low-value-comment-fixtures");
      continue;
    }
    counts.self++;
    const patch = git(directory, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=0",
      before,
      after,
      "--",
      path,
    ]).toString("utf8");
    const target = commentLabels(
      bytes.toString("utf8"),
      afterFiles.get(path).toString("utf8"),
      oldDiffRanges(patch),
      path,
    );
    if (!target.report.length && !target.preserve.length) {
      skip("self-file", path, "no-comment-labels");
      continue;
    }
    const group = path.split("/").slice(0, 3).join("/");
    if (!groups.has(group))
      groups.set(group, { report: [], preserve: [], forbidden: [] });
    const labels = groups.get(group);
    labels.report.push(...target.report);
    labels.preserve.push(...target.preserve);
  }
  const all = { report: [], preserve: [], forbidden: [] };
  for (const group of groups.values()) {
    all.report.push(...group.report);
    all.preserve.push(...group.preserve);
  }
  counts["self-comment-issues"] = all.report.length;
  counts["self-preserve-comments"] = all.preserve.length;
  const overlays = contrasts
    ? ["source-instructions", "no-instructions"]
    : ["source-instructions"];
  for (const overlay of overlays) {
    const contents = new Map(files);
    const previous = parentFiles ? new Map(parentFiles) : undefined;
    if (overlay === "no-instructions") {
      contents.delete("AGENTS.md");
      previous?.delete("AGENTS.md");
    }
    const repo = materialize(
      join(outputDir, "repos", `self-${overlay}`),
      contents,
      previous,
    );
    for (const [group, target] of groups) {
      for (const scope of contrasts
        ? ["repository", "branch"]
        : ["repository"]) {
        accept({
          id: `self/comments/${group}/${overlay}/${scope}`,
          family: "self",
          cluster: "repository:degreaser-axi",
          labelKind: "owner-diff",
          aspects: ["low-value-comments"],
          repo,
          split: hashBucket(`self-group:${group}`) < 7 ? "dev" : "regression",
          paths: ordered(
            new Set([...target.report, ...target.preserve].map((l) => l.path)),
          ),
          review: {
            scope,
            ...(scope === "branch" ? { base: repo.base } : {}),
            task: TASK,
          },
          target,
          ...(contrasts
            ? { contrast: { group: `self/comments/${group}`, overlay, scope } }
            : {}),
          provenance: {
            source: "self",
            revision: before,
            ownerRevision: after,
            parentRevision: parent,
            sourceTreeSha256,
            comparison:
              "actual owner deletion of complete lexical comments; grouped multiline issues",
            unlabelledSource:
              "PRESERVE: comment blocks outside every owner diff range and unchanged in the owner revision, in files present in both revisions; other surviving comments and code remain unknown; test/live/support/comment-fixtures.ts is excluded in both directions",
            context:
              "original source, tests and tooling plus optional original AGENTS.md; no dependencies or skills",
            ...(contrasts
              ? {
                  branchBase:
                    "original before-revision parent, projected to same source-only context",
                }
              : {}),
          },
        });
      }
    }
  }
  if (all.report.length + all.preserve.length)
    accept({
      id: "self-whole/comments/whole-repository",
      family: "self-whole",
      cluster: "repository:degreaser-axi",
      split: "regression",
      labelKind: "owner-diff",
      aspects: ["low-value-comments"],
      repo: materialize(join(outputDir, "repos", "self-whole"), files),
      paths: [],
      review: { scope: "repository", task: TASK },
      target: all,
      provenance: {
        source: "self",
        revision: before,
        ownerRevision: after,
        parentRevision: parent,
        sourceTreeSha256,
        comparison:
          "union of all self REPORT and PRESERVE anchors; empty paths audit the whole repository",
        unlabelledSource:
          "surviving comments and untouched code remain unknown outside the PRESERVE rule",
        context: "original source, tests, tooling and AGENTS.md",
      },
    });
  return {
    source: "self",
    revision: before,
    ownerRevision: after,
    parentRevision: parent,
    sourceTreeSha256,
    ownerTreeSha256: digest(afterFiles),
    ...(parentFiles ? { parentTreeSha256: digest(parentFiles) } : {}),
  };
}
