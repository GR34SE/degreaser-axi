import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commentLabels, oldDiffRanges } from "./comments.mjs";

const SELF_BEFORE = "b4a1edec03d31b01145b923dc5b4dc0d944de0c9";
const SELF_AFTER = "d232af804ae532c4bd4bf79f56d4d854d7ef2715";
const CHECKOUT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = "test/live/support/comment-fixtures.ts";
const TASK =
  "Audit the selected source for low-value comments. Preserve comments that explain non-obvious constraints, invariants, security boundaries or tradeoffs.";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function git(directory, args, input) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  // Set by Git hooks; inherited, they would redirect commands to the caller's repository.
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    delete env[key];
  env.GIT_AUTHOR_DATE = "2000-01-01T00:00:00Z";
  env.GIT_COMMITTER_DATE = env.GIT_AUTHOR_DATE;
  return execFileSync("git", ["-C", directory, ...args], {
    input,
    env,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

const text = (...args) =>
  git(...args)
    .toString("utf8")
    .trim();

function gitTree(directory, revision) {
  const files = new Map();
  for (const entry of text(directory, ["ls-tree", "-rz", revision])
    .split("\0")
    .filter(Boolean)) {
    const [header, path] = entry.split("\t");
    if (/^(?:src|test|tools|scripts|bin)\//u.test(path) || path === "AGENTS.md")
      files.set(
        path,
        git(directory, ["cat-file", "blob", header.split(" ")[2]]),
      );
  }
  return files;
}

function materialize(directory, files) {
  mkdirSync(directory, { recursive: true });
  git(directory, [
    "init",
    "--quiet",
    "--template=",
    "--initial-branch=dataset",
  ]);
  const paths = [...files.keys()];
  for (const [path, content] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content, { flag: "wx", mode: 0o600 });
  }
  const oids = text(
    directory,
    ["hash-object", "-w", "--no-filters", "--stdin-paths"],
    paths.join("\n"),
  ).split("\n");
  git(
    directory,
    ["update-index", "--add", "--index-info"],
    paths.map((path, i) => `100644 ${oids[i]}\t${path}\n`).join(""),
  );
  const head = text(
    directory,
    ["commit-tree", text(directory, ["write-tree"])],
    "Source-only evaluation snapshot\n",
  );
  git(directory, ["update-ref", "refs/heads/dataset", head]);
  return { directory, head };
}

function labelsByGroup(repo, before, after, files) {
  const afterFiles = gitTree(repo, after);
  const groups = new Map();
  for (const [path, content] of files) {
    if (
      !/\.[cm]?tsx?$/u.test(path) ||
      !afterFiles.has(path) ||
      path === FIXTURES
    )
      continue;
    const patch = text(repo, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=0",
      before,
      after,
      "--",
      path,
    ]);
    const { report, preserve } = commentLabels(
      content.toString("utf8"),
      afterFiles.get(path).toString("utf8"),
      oldDiffRanges(patch),
      path,
    );
    if (!report.length && !preserve.length) continue;
    const group = path.split("/").slice(0, 3).join("/");
    const labels = groups.get(group) ?? { report: [], preserve: [] };
    labels.report.push(...report);
    labels.preserve.push(...preserve);
    groups.set(group, labels);
  }
  return groups;
}

export function deriveDatasets({
  outputDir,
  repo = CHECKOUT,
  before = SELF_BEFORE,
  after = SELF_AFTER,
}) {
  for (const revision of [before, after]) {
    try {
      git(repo, ["cat-file", "-e", `${revision}^{commit}`]);
    } catch {
      throw new Error(
        `Pinned self revision ${revision} is missing from ${repo}. Fetch the main branch there.`,
      );
    }
  }
  const output = resolve(outputDir);
  mkdirSync(output);
  const files = gitTree(repo, before);
  const groups = labelsByGroup(repo, before, after, files);
  const provenance = {
    source: "self",
    revision: before,
    ownerRevision: after,
    parentRevision: text(repo, ["rev-parse", `${before}^`]),
    sourceTreeSha256: sha256(
      [...files]
        .map(([path, content]) => `${path}\0${sha256(content)}`)
        .join("\n"),
    ),
  };
  const sample = (id, family, split, snapshot, paths, target, details) => ({
    id,
    family,
    cluster: "repository:degreaser-axi",
    split,
    labelKind: "owner-diff",
    aspects: ["low-value-comments"],
    repo: { directory: snapshot.directory },
    review: { scope: "repository", task: TASK, paths },
    target: { ...target, forbidden: [] },
    provenance: { ...provenance, ...details, materializedHead: snapshot.head },
  });
  const grouped = materialize(
    join(output, "repos", "self-source-instructions"),
    files,
  );
  const samples = [...groups].map(([group, target]) => {
    const bucket = Number.parseInt(
      sha256(`degreaser-eval-v1:self-group:${group}`).slice(0, 8),
      16,
    );
    return sample(
      `self/comments/${group}/source-instructions/repository`,
      "self",
      bucket % 10 < 7 ? "dev" : "regression",
      grouped,
      [
        ...new Set([...target.report, ...target.preserve].map((l) => l.path)),
      ].sort(),
      target,
      {
        comparison:
          "actual owner deletion of complete lexical comments; grouped multiline issues",
        unlabelledSource: `PRESERVE: comment blocks outside every owner diff range and unchanged in the owner revision, in files present in both revisions; other surviving comments and code remain unknown; ${FIXTURES} is excluded in both directions`,
        context:
          "original source, tests and tooling plus optional original AGENTS.md; no dependencies or skills",
      },
    );
  });
  const all = [...groups.values()];
  samples.push(
    sample(
      "self-whole/comments/whole-repository",
      "self-whole",
      "regression",
      materialize(join(output, "repos", "self-whole"), files),
      [],
      {
        report: all.flatMap((target) => target.report),
        preserve: all.flatMap((target) => target.preserve),
      },
      {
        comparison:
          "union of all self REPORT and PRESERVE anchors; empty paths audit the whole repository",
        unlabelledSource:
          "surviving comments and untouched code remain unknown outside the PRESERVE rule",
        context: "original source, tests, tooling and AGENTS.md",
      },
    ),
  );
  samples.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(
    join(output, "samples.jsonl"),
    samples.map((sample) => `${JSON.stringify(sample)}\n`).join(""),
    { flag: "wx" },
  );
  return samples;
}
