import { join } from "node:path";
import { commentLabels, oldDiffRanges } from "./anchors.mjs";
import { git, gitTree, materialize, ordered, sha256 } from "./io.mjs";

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
) {
  const before = pinned(directory, SELF_BEFORE);
  const after = pinned(directory, SELF_AFTER);
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
    if (!patch) continue;
    counts.self++;
    const target = commentLabels(
      bytes.toString("utf8"),
      afterFiles.get(path).toString("utf8"),
      oldDiffRanges(patch),
      path,
    );
    if (!target.report.length) {
      skip("self-file", path, "no-fully-deleted-comment-issue");
      continue;
    }
    const group = path.split("/").slice(0, 3).join("/");
    if (!groups.has(group))
      groups.set(group, { report: [], preserve: [], forbidden: [] });
    const labels = groups.get(group);
    labels.report.push(...target.report);
  }
  counts["self-comment-issues"] = [...groups.values()].reduce(
    (sum, group) => sum + group.report.length,
    0,
  );
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
          paths: ordered(new Set(target.report.map((label) => label.path))),
          review: {
            scope,
            ...(scope === "branch" ? { base: repo.base } : {}),
            task: "Audit the selected source for low-value comments. Preserve comments that explain non-obvious constraints, invariants, security boundaries or tradeoffs.",
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
              "surviving comments and untouched code remain unknown; no PRESERVE labels",
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
