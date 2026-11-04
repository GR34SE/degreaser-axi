import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, requireGit } from "./git.ts";
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
  path.split("/").some((part) => generated.includes(part)) ||
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
    if (existsSync(userIndex)) {
      copyFileSync(userIndex, index);
      requireGit(repository, ["update-index", "--no-split-index"], { index });
      const tracked = requireGit(repository, ["ls-files", "-z"], { index });
      if (tracked) {
        requireGit(
          repository,
          ["update-index", "--no-assume-unchanged", "-z", "--stdin"],
          { index, input: tracked },
        );
        requireGit(
          repository,
          ["update-index", "--no-skip-worktree", "-z", "--stdin"],
          { index, input: tracked },
        );
      }
    } else {
      requireGit(repository, ["read-tree", "--empty"], { index });
    }
    const statePaths = nulList(
      requireGit(repository, ["ls-files", "-z", "--", ".degreaser"], { index }),
    );
    if (statePaths.length)
      requireGit(
        repository,
        ["update-index", "--force-remove", "-z", "--stdin"],
        { index, input: `${statePaths.join("\0")}\0` },
      );
    const candidates = [
      ...new Set(
        nulList(
          requireGit(
            repository,
            ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            { index },
          ),
        ),
      ),
    ].filter(
      (path) => path !== ".degreaser" && !path.startsWith(".degreaser/"),
    );
    if (candidates.length) {
      requireGit(
        repository,
        ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
        {
          index,
          input: `${candidates.map((path) => `:(top,literal)${path}`).join("\0")}\0`,
        },
      );
    }
    return requireGit(repository, ["write-tree"], { index }).trim();
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function resolveScope(
  repository: string,
  scope: Scope,
  baseRef: string | undefined,
  extraExclusions: string[],
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
  const pathspecs = [
    ".",
    ":(top,literal,exclude).degreaser",
    ...generated.flatMap((name) => [
      `:(top,glob,exclude)**/${name}`,
      `:(top,glob,exclude)**/${name}/**`,
    ]),
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
  const patch =
    base === null
      ? null
      : requireGit(repository, [
          ...diff,
          "--patch",
          "--unified=3",
          "--",
          ...pathspecs,
        ]);
  const excludedPaths = nulList(
    requireGit(repository, [...diff, "--name-only", "-z"]),
  ).filter((path) => excluded(path, extraExclusions));
  paths.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
        "Only supplied paths are assessed. Excluded or other files may be read as context without becoming reviewed coverage. Built-ins exclude root .degreaser and node_modules/dist/build/coverage directories at any depth.",
      paths: excludedPaths,
    },
  ];
  const binaries = paths.filter((path) => path.binary).map((path) => path.path);
  if (binaries.length)
    limitations.push({
      code: "binary",
      message:
        "Binary file contents are omitted from the text patch; their contents are not assessed.",
      paths: binaries,
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
