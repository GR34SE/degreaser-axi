import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, isUtf8, requireGit, requireGitBytes } from "./git.ts";
import { InputError } from "./input-error.ts";

export type Scope = "worktree" | "branch" | "repository";
export interface ScopePath {
  path: string;
  oldPath: string | null;
  status: string;
  oldMode: string | null;
  newMode: string | null;
  oldOid: string | null;
  newOid: string | null;
  binary: boolean;
}
export interface Limitation {
  code: string;
  message: string;
  paths?: string[];
}
export interface ResolvedScope {
  base: string | null;
  tree: string;
  paths: ScopePath[];
  excludedPaths: string[];
  patch: string | null;
  limitations: Limitation[];
}

const generated = ["node_modules", "dist", "build", "coverage"];
const diffFlags = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--no-relative",
  "--ignore-submodules=none",
  "--submodule=short",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--diff-algorithm=myers",
  "--no-indent-heuristic",
  "-M50%",
];
const nulList = (value: string) => value.split("\0").filter(Boolean);
const excluded = (path: string, extra: string[]) =>
  path === ".degreaser" ||
  path.startsWith(".degreaser/") ||
  // Directory components only: `scripts/build` or `dist.go` files stay assessable.
  path
    .split("/")
    .slice(0, -1)
    .some((part) => generated.includes(part)) ||
  extra.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

function parseRaw(raw: string): ScopePath[] {
  const tokens = nulList(raw);
  const entries: ScopePath[] = [];
  for (let i = 0; i < tokens.length; ) {
    const header = tokens[i++];
    const first = tokens[i++];
    if (!header || first === undefined)
      throw new InputError("Invalid Git raw path record.");
    const [oldMode, newMode, oldOid, newOid, status] = header
      .slice(1)
      .split(" ");
    if (!oldMode || !newMode || !oldOid || !newOid || !status)
      throw new InputError("Invalid Git raw header.");
    const path = status.startsWith("R") ? tokens[i++] : first;
    if (path === undefined)
      throw new InputError("Missing Git rename destination.");
    entries.push({
      path,
      oldPath: status === "A" ? null : first,
      status,
      oldMode: oldMode === "000000" ? null : oldMode,
      newMode: newMode === "000000" ? null : newMode,
      oldOid: /^0+$/.test(oldOid) ? null : oldOid,
      newOid: /^0+$/.test(newOid) ? null : newOid,
      binary: false,
    });
  }
  return entries;
}

function binaryPaths(numstat: string): Set<string> {
  const tokens = nulList(numstat);
  const paths = new Set<string>();
  for (let i = 0; i < tokens.length; ) {
    const record = tokens[i++];
    if (record === undefined) break;
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    let path = record.slice(second + 1);
    if (path === "") {
      i++; // Rename source; coverage and evidence use both sides from --raw.
      path = tokens[i++] ?? "";
    }
    if (record.slice(0, first) === "-") paths.add(path);
  }
  return paths;
}

/**
 * Git emits patch sections in the same order as `--raw`, so section i belongs to
 * raw entry i. A section whose bytes are not valid UTF-8 (a Latin-1 file, on
 * either side) is replaced by Git's own binary stub and its path is marked
 * binary, so coverage, evidence checks and reports treat it like any binary file.
 */
function omitNonUtf8Sections(
  patch: Buffer,
  paths: ScopePath[],
  omitted: Set<string>,
): string {
  if (isUtf8(patch)) return patch.toString("utf8");
  const marker = Buffer.from("diff --git ");
  const starts: number[] = [];
  for (let at = patch.indexOf(marker); at !== -1; ) {
    if (at === 0 || patch[at - 1] === 0x0a) starts.push(at);
    at = patch.indexOf(marker, at + 1);
  }
  if (starts.length !== paths.length || starts[0] !== 0)
    throw new InputError(
      "Git patch sections do not match the changed paths; no run was started.",
    );
  return starts
    .map((start, i) => {
      const section = patch.subarray(start, starts[i + 1] ?? patch.length);
      if (isUtf8(section)) return section.toString("utf8");
      const path = paths[i];
      if (!path) throw new InputError("Git patch section has no path record.");
      path.binary = true;
      omitted.add(path.path);
      const lines = section.toString("latin1").split("\n");
      const label = (prefix: string) =>
        lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
      const head = lines.slice(
        0,
        lines.findIndex((line) => line.startsWith("--- ")),
      );
      return `${head.join("\n")}\nBinary files ${label("--- ")} and ${label("+++ ")} differ\n`;
    })
    .join("");
}

function resolveBase(
  repository: string,
  scope: Scope,
  baseRef: string | undefined,
): string | null {
  if (requireGit(repository, ["ls-files", "--unmerged", "-z"]))
    throw new InputError("Resolve the unmerged index before review.");
  const head = git(
    repository,
    ["rev-parse", "--verify", "-q", "HEAD^{commit}"],
    { allowFailure: true },
  )?.trim();
  if (scope === "repository") return null;
  if (scope === "worktree")
    return (
      head ??
      requireGit(repository, ["hash-object", "-w", "-t", "tree", "--stdin"], {
        input: "",
      }).trim()
    );
  if (!head)
    throw new InputError("Branch review requires an existing HEAD commit.");
  const target = git(
    repository,
    ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`],
    { allowFailure: true },
  )?.trim();
  if (!target)
    throw new InputError(
      "The explicit branch base must resolve to an available commit.",
    );
  const bases = git(repository, ["merge-base", "--all", head, target], {
    allowFailure: true,
  })
    ?.trim()
    .split("\n");
  if (bases?.length !== 1 || !bases[0])
    throw new InputError(
      "Branch review requires one available merge-base; history is missing, unrelated or ambiguous. No fetch was attempted.",
    );
  return bases[0];
}

function resolveTree(repository: string): string {
  const temporary = mkdtempSync(join(tmpdir(), "degreaser-index-"));
  const index = join(temporary, "index");
  try {
    const userIndex = requireGit(repository, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]).trimEnd();
    const sourceStat = existsSync(userIndex)
      ? statSync(userIndex, { bigint: true })
      : null;
    const indexGit = (args: string[], options: { input?: string } = {}) => {
      // Copies and preparatory writes must not hide racily clean entries.
      // Whole seconds avoid rounding the original nanoseconds upward.
      if (sourceStat)
        utimesSync(
          index,
          Number(sourceStat.atimeNs / 1_000_000_000n),
          Number(sourceStat.mtimeNs / 1_000_000_000n),
        );
      return requireGit(repository, args, { ...options, index });
    };
    if (sourceStat) {
      copyFileSync(userIndex, index);
      indexGit(["update-index", "--no-split-index"]);
      const tracked = indexGit(["ls-files", "-z"]);
      if (tracked) {
        indexGit(["update-index", "--no-assume-unchanged", "-z", "--stdin"], {
          input: tracked,
        });
        indexGit(["update-index", "--no-skip-worktree", "-z", "--stdin"], {
          input: tracked,
        });
      }
    } else {
      indexGit(["read-tree", "--empty"]);
    }
    // One recursive pathspec: Git matches pathspecs per file, so listing every
    // file as its own literal pathspec is quadratic and times out on monorepos.
    // An exclude pathspec would make `add` fail on an ignored .degreaser, so
    // root run state is removed from the temporary index afterwards.
    // The exclude pathspec keeps unignored run state from being hashed into
    // objects; it cannot be used when .degreaser is ignored (see above).
    const stateIgnored =
      git(repository, ["check-ignore", "-q", "--no-index", ".degreaser"], {
        allowFailure: true,
        index,
      }) !== null;
    indexGit([
      "add",
      "-A",
      "--",
      ":(top)",
      ...(stateIgnored ? [] : [":(top,literal,exclude).degreaser"]),
    ]);
    const statePaths = nulList(
      indexGit(["ls-files", "-z", "--", ".degreaser"]),
    );
    if (statePaths.length)
      indexGit(["update-index", "--force-remove", "-z", "--stdin"], {
        input: `${statePaths.join("\0")}\0`,
      });
    return indexGit(["write-tree"]).trim();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function resolveScope(
  repository: string,
  scope: Scope,
  baseRef: string | undefined,
  extraExclusions: string[],
  pathPatterns: string[] = [],
): ResolvedScope {
  const base = resolveBase(repository, scope, baseRef);
  if (
    git(repository, ["config", "--bool", "core.sparseCheckout"], {
      allowFailure: true,
    })?.trim() === "true"
  ) {
    throw new InputError(
      "Sparse checkout is not supported for final-worktree review; use a complete working tree.",
    );
  }
  const tree = resolveTree(repository);
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
    requireGit(repository, ["hash-object", "-w", "-t", "tree", "--stdin"], {
      input: "",
    }).trim();
  const diff = ["diff", ...diffFlags, comparisonBase, tree];
  const paths = parseRaw(
    requireGit(repository, [
      ...diff,
      "--raw",
      "--no-abbrev",
      "-z",
      "--",
      ...pathspecs,
    ]),
  );
  const binarySet = binaryPaths(
    requireGit(repository, [...diff, "--numstat", "-z", "--", ...pathspecs]),
  );
  for (const path of paths) {
    path.binary = binarySet.has(path.path);
    if (base === null) path.status = "audit";
  }
  const textPatch =
    base === null
      ? null
      : requireGitBytes(repository, [
          ...diff,
          "--patch",
          "--unified=3",
          "--",
          ...pathspecs,
        ]);
  if (pathPatterns.length && !paths.length && scope !== "repository") {
    const changed = requireGit(repository, [
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
  const patch = textPatch && omitNonUtf8Sections(textPatch, paths, nonUtf8Set);
  const excludedPaths = nulList(
    requireGit(repository, [...diff, "--name-only", "-z", "--", ...selection]),
  ).filter((path) => excluded(path, extraExclusions));
  // Paths stay in Git's emission order, which is also the patch section order.
  const limitations: Limitation[] = [
    {
      code: "git-object-writes",
      message:
        "Temporary-index resolution writes Git objects, not the user index, refs or working files. Unreferenced objects may later be pruned by Git.",
    },
    {
      code: "live-context",
      message:
        "This tree and patch are resolved input, not an atomic repository snapshot. Context reads use live files; callers must not edit during review. Ignored dependencies and external state are not frozen.",
    },
    {
      code: "coverage",
      message:
        "Only supplied paths are assessed. Excluded or other files may be read as context without becoming reviewed coverage. Built-ins exclude root .degreaser and node_modules/dist/build/coverage directories at any depth (files with those names stay assessable).",
      paths: excludedPaths,
    },
    ...(pathPatterns.length
      ? [
          {
            code: "path-selection",
            message: `Assessed paths are limited to --path ${pathPatterns.join(", ")}; other files are context only.`,
          },
        ]
      : []),
  ];
  const binaries = paths
    .filter((path) => path.binary && !nonUtf8Set.has(path.path))
    .map((path) => path.path);
  if (binaries.length)
    limitations.push({
      code: "binary",
      message:
        "Binary file contents are omitted from the text patch; their contents are not assessed.",
      paths: binaries,
    });
  const nonUtf8 = [...nonUtf8Set].sort();
  if (nonUtf8.length)
    limitations.push({
      code: "non-utf8",
      message:
        "Text contents that are not valid UTF-8 are omitted from the patch and treated like binary files; they are not assessed.",
      paths: nonUtf8,
    });
  const gitlinks = paths
    .filter((path) => path.oldMode === "160000" || path.newMode === "160000")
    .map((path) => path.path);
  if (gitlinks.length)
    limitations.push({
      code: "gitlink",
      message:
        "Submodules are represented only by Git commit links; nested or dirty submodule contents are not assessed.",
      paths: gitlinks,
    });
  const names = [
    ...new Set(
      paths.flatMap((path) =>
        path.oldPath ? [path.oldPath, path.path] : [path.path],
      ),
    ),
  ];
  if (names.length) {
    const attrs = nulList(
      requireGit(repository, ["check-attr", "-z", "--stdin", "filter"], {
        input: `${names.join("\0")}\0`,
      }),
    );
    const filtered: string[] = [];
    for (let i = 0; i < attrs.length; i += 3) {
      const path = attrs[i],
        value = attrs[i + 2];
      if (path && value && value !== "unspecified" && value !== "unset")
        filtered.push(path);
    }
    if (filtered.length)
      limitations.push({
        code: "clean-filter",
        message:
          "Git clean filters may execute local commands and store transformed contents (including LFS pointers), not live file bytes. Attributes are inspected from the current worktree.",
        paths: filtered,
      });
  }
  if (paths.some((path) => path.status.startsWith("R")))
    limitations.push({
      code: "rename",
      message:
        "Rename detection follows Git content similarity, not file identity.",
    });
  return { base, tree, paths, excludedPaths, patch, limitations };
}
