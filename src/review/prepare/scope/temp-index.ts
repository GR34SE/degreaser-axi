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
import type { Runtime } from "../../../util/exec/types.ts";
import { git, requireGit } from "../../../util/git/exec.ts";
import { nulList } from "../../../util/text.ts";

export function resolveTree(runtime: Runtime, repository: string): string {
  const temporary = mkdtempSync(join(tmpdir(), "degreaser-index-"));
  const index = join(temporary, "index");
  try {
    const userIndex = requireGit(runtime, repository, [
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
      return requireGit(runtime, repository, args, { ...options, index });
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
    // Unignored run state is excluded so it is never hashed into objects; Git
    // rejects that exclude for an ignored .degreaser, which `add -A` skips
    // anyway. Removing run state from the temporary index is a safety net.
    const stateIgnored =
      git(
        runtime,
        repository,
        ["check-ignore", "-q", "--no-index", ".degreaser"],
        {
          allowFailure: true,
          index,
        },
      ) !== null;
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
