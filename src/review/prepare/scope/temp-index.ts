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
      // Newer index mtimes can hide racily clean edits.
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
    // Per-file pathspecs make Git's matching quadratic. Git rejects an explicit
    // .degreaser exclusion when ignored, so add it only when unignored.
    const stateIgnored =
      git(
        runtime,
        repository,
        ["check-ignore", "-q", "--no-index", ".degreaser"],
        {
          allowFailure: (status) => status === 1,
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
