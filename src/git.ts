import { spawnSync } from "node:child_process";
import { diagnoseFailure } from "./diagnostics.ts";
import { InputError } from "./input-error.ts";
import { workerFailure } from "./worker-failure.ts";

function gitBytes(
  repository: string,
  args: string[],
  options: { index?: string; input?: string; allowFailure?: boolean } = {},
): Buffer | null {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync(
    "git",
    [
      "--no-pager",
      "-c",
      "core.quotePath=false",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...(options.index ? ["-c", "core.splitIndex=false"] : []),
      ...args,
    ],
    {
      cwd: repository,
      env: {
        ...env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_LAZY_FETCH: "1",
        ...(options.index ? { GIT_INDEX_FILE: options.index } : {}),
      },
      input: options.input,
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (!result.error && result.status === 0) {
    return result.stdout;
  }
  const failure =
    result.error ?? new Error(result.stderr?.toString("utf8") ?? "");
  if (workerFailure(failure) === "environment-blocked")
    throw diagnoseFailure(failure, `Git ${args[0]} review input operation`);
  if (options.allowFailure && !result.error && result.status !== null)
    return null;
  throw new InputError(
    `Git ${args[0]} failed while resolving review input. Check repository state, available history, filters and filesystem access; no run was started.`,
  );
}

export const isUtf8 = (bytes: Uint8Array) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/** Strict UTF-8: path names and metadata must never persist replacement characters. */
export function git(
  repository: string,
  args: string[],
  options: { index?: string; input?: string; allowFailure?: boolean } = {},
): string | null {
  const bytes = gitBytes(repository, args, options);
  if (bytes === null) return null;
  if (!isUtf8(bytes))
    throw new InputError(
      "Git input contains non-UTF-8 paths or metadata. Refusing to persist lossy replacement characters; no run was started.",
    );
  return bytes.toString("utf8");
}

/** Raw bytes, for patch text whose non-UTF-8 sections are omitted per file. */
export function requireGitBytes(repository: string, args: string[]): Buffer {
  const result = gitBytes(repository, args);
  if (result === null) throw new Error("Unexpected optional Git failure");
  return result;
}

export function requireGit(
  repository: string,
  args: string[],
  options: { index?: string; input?: string } = {},
): string {
  const result = git(repository, args, options);
  if (result === null) throw new Error("Unexpected optional Git failure");
  return result;
}

export function repositoryRoot(cwd: string): string {
  const root = git(cwd, ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  if (root === null)
    throw new InputError(
      "Not inside a Git repository. Run Degreaser inside the repository you want to review.",
      ["cd <repository> && degreaser-axi"],
    );
  return root.replace(/\n$/, "");
}
