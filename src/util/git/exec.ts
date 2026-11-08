import { diagnoseFailure } from "../diagnostics.ts";
import { InputError } from "../errors.ts";
import { gitEnvironment } from "../exec/env.ts";
import type { Runtime } from "../exec/types.ts";
import { isUtf8 } from "../text.ts";

type GitOptions = {
  index?: string;
  input?: string;
  allowFailure?: (status: number, stderr: string) => boolean;
};

function gitBytes(
  runtime: Runtime,
  repository: string,
  args: string[],
  options: GitOptions = {},
): Buffer | null {
  const env = gitEnvironment(runtime.env);
  const result = runtime.spawnSync(
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
  const stderr = result.stderr?.toString("utf8") ?? "";
  const failure = result.error ?? new Error(stderr);
  const diagnostic = diagnoseFailure(
    failure,
    `Git ${args[0]} review input operation`,
  );
  if (diagnostic.diagnosis === "permission") throw diagnostic;
  if (
    !result.error &&
    result.status !== null &&
    options.allowFailure?.(result.status, stderr)
  )
    return null;
  throw new InputError(
    `Git ${args[0]} failed while resolving review input. Check repository state, available history, filters and filesystem access; no run was started.`,
  );
}

export function git(
  runtime: Runtime,
  repository: string,
  args: string[],
  options: GitOptions = {},
): string | null {
  const bytes = gitBytes(runtime, repository, args, options);
  if (bytes === null) return null;
  if (!isUtf8(bytes))
    throw new InputError(
      "Git input contains non-UTF-8 paths or metadata. Refusing to persist lossy replacement characters; no run was started.",
    );
  return bytes.toString("utf8");
}

export function requireGitBytes(
  runtime: Runtime,
  repository: string,
  args: string[],
): Buffer {
  const result = gitBytes(runtime, repository, args);
  if (result === null) throw new Error("Unexpected optional Git failure");
  return result;
}

export function requireGit(
  runtime: Runtime,
  repository: string,
  args: string[],
  options: { index?: string; input?: string } = {},
): string {
  const result = git(runtime, repository, args, options);
  if (result === null) throw new Error("Unexpected optional Git failure");
  return result;
}
