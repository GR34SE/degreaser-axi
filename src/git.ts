import { spawnSync } from "node:child_process";
import { InputError } from "./input-error.ts";

export function git(
  repository: string,
  args: string[],
  options: { index?: string; input?: string; allowFailure?: boolean } = {},
): string | null {
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
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
    } catch {
      throw new InputError(
        "Git input contains non-UTF-8 paths or text. Refusing to persist lossy replacement characters; no run was started.",
      );
    }
  }
  if (options.allowFailure && !result.error && result.status !== null)
    return null;
  throw new InputError(
    `Git ${args[0]} failed while resolving review input. Check repository state, available history, filters and filesystem access; no run was started.`,
  );
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
  const root = requireGit(cwd, ["rev-parse", "--show-toplevel"]);
  return root.replace(/\n$/, "");
}
