import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewRequest } from "../../../review/types.ts";
import { InputError } from "../../../util/errors.ts";
import type { CommandOptions } from "../../types.ts";

export function positiveInteger(
  value: string,
  name: string,
  maximum: number,
): number {
  const number = Number(value);
  if (
    !/^[0-9]+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum
  ) {
    throw new InputError(
      `${name} must be a positive integer no greater than ${maximum}.`,
    );
  }
  return number;
}

function validPathPatterns(values: unknown): string[] {
  const patterns = (values ?? []) as string[];
  for (const pattern of patterns) {
    if (
      !pattern ||
      pattern.startsWith(":") ||
      /[\\\0]/.test(pattern) ||
      pattern.split("/").some((part) => ["", ".", ".."].includes(part))
    )
      throw new InputError(
        `Invalid --path ${JSON.stringify(pattern)}: use a nonempty Git-root-relative path or glob without a leading "/" or ":", trailing or repeated "/", "."/".." components, backslashes or NUL.`,
      );
  }
  if (new Set(patterns).size !== patterns.length)
    throw new InputError("Duplicate --path patterns are ambiguous.");
  return patterns;
}

export function parseReviewArguments(
  parsed: CommandOptions,
  cwd: string,
): ReviewRequest {
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== "option" || token.name === "path") continue;
    if (seen.has(token.name))
      throw new InputError(`Duplicate --${token.name} is ambiguous.`);
    seen.add(token.name);
  }
  const value = (key: string): string | undefined => {
    const data = parsed.values[key];
    if (data === undefined) return undefined;
    if (typeof data !== "string")
      throw new InputError(`--${key} requires a string.`);
    return data;
  };
  const scope = value("scope");
  if (scope !== "worktree" && scope !== "branch" && scope !== "repository")
    throw new InputError(
      "Explicit --scope must be worktree, branch or repository.",
    );
  const baseRef = value("base");
  if (scope === "branch") {
    if (!baseRef?.trim() || baseRef.startsWith("-"))
      throw new InputError(
        "Branch scope requires a nonempty explicit --base commit/ref.",
      );
  } else if (baseRef !== undefined)
    throw new InputError("--base is only valid for branch scope.");
  const inline = value("task"),
    file = value("task-file");
  if ((inline === undefined) === (file === undefined))
    throw new InputError("Exactly one of --task or --task-file is required.");
  let task = inline;
  if (file !== undefined) {
    if (!file.trim())
      throw new InputError("--task-file requires a nonempty path.");
    try {
      task = new TextDecoder("utf-8", { fatal: true }).decode(
        readFileSync(resolve(cwd, file)),
      );
    } catch {
      throw new InputError("--task-file must name a readable UTF-8 text file.");
    }
  }
  if (!task?.trim() || task.includes("\0"))
    throw new InputError("Task must be nonempty text without NUL bytes.");
  const aspects = value("aspects");
  const concurrency = value("concurrency");
  const wait = value("wait");
  return {
    scope,
    baseRef,
    task,
    ...(file !== undefined ? { taskFile: resolve(cwd, file) } : {}),
    pathPatterns: validPathPatterns(parsed.values.path),
    controls: {
      ...(aspects !== undefined ? { aspects: aspects.split(",") } : {}),
      ...(concurrency !== undefined
        ? {
            concurrency: positiveInteger(
              concurrency,
              "--concurrency",
              Number.MAX_SAFE_INTEGER,
            ),
          }
        : {}),
    },
    waitSeconds:
      wait === undefined ? 480 : positiveInteger(wait, "--wait", 2147483),
  };
}
