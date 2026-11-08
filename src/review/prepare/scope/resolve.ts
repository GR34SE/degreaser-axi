import { InputError } from "../../../util/errors.ts";
import type { Runtime } from "../../../util/exec/types.ts";
import { git, requireGit, requireGitBytes } from "../../../util/git/exec.ts";
import { nulList } from "../../../util/text.ts";
import {
  binaryPaths,
  diffFlags,
  omitNonUtf8Sections,
  parseRaw,
  readLinkTargets,
} from "./diff.ts";
import { scopeLimitations } from "./limitations.ts";
import { resolveTree } from "./temp-index.ts";
import type { ResolvedScope, Scope } from "./types.ts";

const generated = ["node_modules", "dist", "build", "coverage"];
const excluded = (path: string, extra: string[]) =>
  path === ".degreaser" ||
  path.startsWith(".degreaser/") ||
  // Directory components only: `scripts/build` or `dist.go` files stay assessable.
  path
    .split("/")
    .slice(0, -1)
    .some((part) => generated.includes(part)) ||
  extra.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

function resolveBase(
  runtime: Runtime,
  repository: string,
  scope: Scope,
  baseRef: string | undefined,
): string | null {
  if (requireGit(runtime, repository, ["ls-files", "--unmerged", "-z"]))
    throw new InputError("Resolve the unmerged index before review.");
  const head = git(
    runtime,
    repository,
    ["rev-parse", "--verify", "-q", "HEAD^{commit}"],
    { allowFailure: true },
  )?.trim();
  if (scope === "repository") return null;
  if (scope === "worktree")
    return (
      head ??
      requireGit(
        runtime,
        repository,
        ["hash-object", "-w", "-t", "tree", "--stdin"],
        {
          input: "",
        },
      ).trim()
    );
  if (!head)
    throw new InputError("Branch review requires an existing HEAD commit.");
  const target = git(
    runtime,
    repository,
    ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`],
    { allowFailure: true },
  )?.trim();
  if (!target)
    throw new InputError(
      "The explicit branch base must resolve to an available commit.",
    );
  const bases = git(
    runtime,
    repository,
    ["merge-base", "--all", head, target],
    {
      allowFailure: true,
    },
  )
    ?.trim()
    .split("\n");
  if (bases?.length !== 1 || !bases[0])
    throw new InputError(
      "Branch review requires one available merge-base; history is missing, unrelated or ambiguous. No fetch was attempted.",
    );
  return bases[0];
}

export function resolveScope(
  runtime: Runtime,
  repository: string,
  scope: Scope,
  baseRef: string | undefined,
  extraExclusions: string[],
  pathPatterns: string[] = [],
): ResolvedScope {
  const base = resolveBase(runtime, repository, scope, baseRef);
  if (
    git(runtime, repository, ["config", "--bool", "core.sparseCheckout"], {
      allowFailure: true,
    })?.trim() === "true"
  ) {
    throw new InputError(
      "Sparse checkout is not supported for final-worktree review; use a complete working tree.",
    );
  }
  const tree = resolveTree(runtime, repository);
  // Git glob magic prefix-matches only wildcard-free directories (`landing`),
  // so `/**` extends wildcard matches (`packages/*/src`) beneath them; literal
  // magic keeps bracketed names such as `app/[slug]` selectable as written.
  const selection = pathPatterns.length
    ? pathPatterns.flatMap((p) => [
        `:(top,glob)${p}`,
        `:(top,glob)${p}/**`,
        `:(top,literal)${p}`,
      ])
    : ["."];
  const pathspecs = [
    ...selection,
    ":(top,literal,exclude).degreaser",
    ...generated.map((name) => `:(top,glob,exclude)**/${name}/**`),
    ...extraExclusions.map((path) => `:(top,literal,exclude)${path}`),
  ];
  // An empty tree enumerates audit metadata; no audit change patch is emitted.
  const comparisonBase =
    base ??
    requireGit(
      runtime,
      repository,
      ["hash-object", "-w", "-t", "tree", "--stdin"],
      {
        input: "",
      },
    ).trim();
  const diff = ["diff", ...diffFlags, comparisonBase, tree];
  const paths = parseRaw(
    requireGit(runtime, repository, [
      ...diff,
      "--raw",
      "--no-abbrev",
      "-z",
      "--",
      ...pathspecs,
    ]),
  );
  const binarySet = binaryPaths(
    requireGit(runtime, repository, [
      ...diff,
      "--numstat",
      "-z",
      "--",
      ...pathspecs,
    ]),
  );
  for (const path of paths) {
    path.binary = binarySet.has(path.path);
    if (base === null) path.status = "audit";
  }
  const textPatch =
    base === null
      ? null
      : requireGitBytes(runtime, repository, [
          ...diff,
          "--patch",
          "--unified=3",
          "--",
          ...pathspecs,
        ]);
  if (pathPatterns.length && !paths.length && scope !== "repository") {
    const changed = requireGit(runtime, repository, [
      ...diff,
      "--name-only",
      "-z",
      "--",
      ".",
      ...pathspecs.slice(selection.length),
    ]);
    if (changed)
      throw new InputError(
        `No changed assessable file matches --path ${pathPatterns.join(", ")} in ${scope} scope (after exclusions); check for typos or run without --path. No review was started.`,
      );
  }
  const nonUtf8Set = new Set<string>();
  readLinkTargets(runtime, repository, paths, nonUtf8Set);
  const patch = textPatch && omitNonUtf8Sections(textPatch, paths, nonUtf8Set);
  const excludedPaths = nulList(
    requireGit(runtime, repository, [
      ...diff,
      "--name-only",
      "-z",
      "--",
      ...selection,
    ]),
  ).filter((path) => excluded(path, extraExclusions));
  const limitations = scopeLimitations(
    runtime,
    repository,
    paths,
    excludedPaths,
    pathPatterns,
    nonUtf8Set,
  );
  return { base, tree, paths, excludedPaths, patch, limitations };
}
