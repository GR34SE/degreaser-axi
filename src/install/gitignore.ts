import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputError } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { git, requireGit } from "../util/git/exec.ts";
import { repositoryRoot } from "../util/git/repository.ts";

export function ensureStateIgnored(
  runtime: Runtime,
  repository: string,
): {
  changed: boolean;
  tracked: boolean;
} {
  const root = repositoryRoot(runtime, repository);
  const path = join(root, ".gitignore");
  let original: Buffer | null = null;
  try {
    if (!lstatSync(path).isFile())
      throw new InputError(
        "Root .gitignore must be a regular file, not a symlink.",
      );
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(fd).isFile())
        throw new InputError(
          "Root .gitignore must be a regular file, not a symlink.",
        );
      original = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

  const tracked =
    requireGit(runtime, root, ["ls-files", "-z", "--", ".degreaser"]).length >
    0;
  const scratch = mkdtempSync(join(tmpdir(), "degreaser-ignore-"));
  let covered: boolean;
  try {
    requireGit(runtime, scratch, ["init", "--quiet", "--template="]);
    if (original !== null) writeFileSync(join(scratch, ".gitignore"), original);
    covered =
      git(
        runtime,
        scratch,
        [
          "-c",
          "core.excludesFile=/dev/null",
          "check-ignore",
          "--no-index",
          "-q",
          ".degreaser/",
        ],
        {
          allowFailure: true,
        },
      ) !== null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (covered) return { changed: false, tracked };

  const prefix =
    original && original.length > 0 && original[original.length - 1] !== 10
      ? "\n"
      : "";
  const fd = openSync(
    path,
    original === null
      ? constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW
      : constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW,
    0o666,
  );
  try {
    if (
      !fstatSync(fd).isFile() ||
      (original !== null && !readFileSync(fd).equals(original))
    )
      throw new InputError(
        "Root .gitignore changed while preparing init; retry.",
      );
    writeFileSync(fd, `${prefix}/.degreaser/\n`);
  } finally {
    closeSync(fd);
  }
  return { changed: true, tracked };
}
