import type { Runtime } from "../../../util/exec/types.ts";
import { requireGit } from "../../../util/git/exec.ts";
import { nulList } from "../../../util/text.ts";
import type { Limitation, ScopePath } from "./types.ts";

export function scopeLimitations(
  runtime: Runtime,
  repository: string,
  paths: ScopePath[],
  excludedPaths: string[],
  pathPatterns: string[],
  nonUtf8Set: Set<string>,
): Limitation[] {
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
      requireGit(
        runtime,
        repository,
        ["check-attr", "-z", "--stdin", "filter"],
        {
          input: `${names.join("\0")}\0`,
        },
      ),
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
  return limitations;
}
