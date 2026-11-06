import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { COMMANDS } from "./commands.ts";
import {
  type Assignment,
  loadConfig,
  type ReviewControls,
  resolveConfig,
} from "./config.ts";
import { repositoryRoot } from "./git.ts";
import { InputError } from "./input-error.ts";
import { resolveScope, type Scope } from "./scope.ts";

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

/** Plain repository-relative patterns; scope.ts alone adds Git pathspec magic. */
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

interface ReviewRequest {
  scope: Scope;
  baseRef: string | undefined;
  task: string;
  taskFile?: string;
  pathPatterns: string[];
  controls: ReviewControls;
  waitSeconds: number;
}

export function parseReviewArguments(
  args: string[],
  cwd: string,
): ReviewRequest {
  const command = COMMANDS.review;
  if (!command) throw new Error("Missing review declaration");
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: command.flags,
    });
  } catch (error) {
    throw new InputError(
      `${error instanceof Error ? error.message : "Invalid review arguments."} Valid flags: ${Object.keys(
        command.flags,
      )
        .map((flag) => `--${flag}`)
        .join(", ")}. No positional arguments are accepted.`,
    );
  }
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

export function prepareReview(args: string[], cwd: string) {
  const request = parseReviewArguments(args, cwd);
  const repository = repositoryRoot(cwd);
  const config = resolveConfig(loadConfig(repository), request.controls);
  const scope = resolveScope(
    repository,
    request.scope,
    request.baseRef,
    config.exclude,
    request.pathPatterns,
  );
  if (
    request.scope === "repository" &&
    request.pathPatterns.length &&
    !scope.paths.length
  )
    throw new InputError(
      `No assessable repository files match --path ${request.pathPatterns.join(", ")} after exclusions; no review was started.`,
    );
  const noChanges = request.scope !== "repository" && scope.paths.length === 0;
  const coordinatorResults =
    request.scope === "repository" &&
    config.assignments.some((a) => a.aspect === "A08")
      ? [
          {
            aspect: "A08" as const,
            status: "not-applicable" as const,
            findings: [],
            limitations: [],
            reason:
              "An explicit repository audit has no feature-change scope to assess for A08.",
          },
        ]
      : [];
  const workers: Assignment[] = noChanges
    ? []
    : config.assignments.filter(
        (a) => !coordinatorResults.some((result) => result.aspect === a.aspect),
      );
  return {
    schemaVersion: 1 as const,
    status: noChanges ? ("no-changes" as const) : ("ready" as const),
    repository,
    scope: request.scope,
    baseRef: request.baseRef ?? null,
    task: request.task,
    ...(request.taskFile ? { taskFile: request.taskFile } : {}),
    // Absent rather than empty keeps unnarrowed review identities unchanged.
    ...(request.pathPatterns.length
      ? { pathPatterns: request.pathPatterns }
      : {}),
    waitSeconds: request.waitSeconds,
    config,
    ...scope,
    workers,
    coordinatorResults,
  };
}

export type ReviewInput = ReturnType<typeof prepareReview>;

export function reviewCommand(input: ReviewInput) {
  const quote = (value: string) =>
    /^[a-zA-Z0-9_./,:=-]+$/.test(value)
      ? value
      : `'${value.replaceAll("'", "'\\''")}'`;
  return [
    "degreaser-axi review",
    `--scope ${input.scope}`,
    ...(input.baseRef ? [`--base ${quote(input.baseRef)}`] : []),
    input.taskFile
      ? `--task-file ${quote(input.taskFile)}`
      : `--task=${quote(input.task)}`,
    ...(input.pathPatterns ?? []).map((p) => `--path ${quote(p)}`),
    `--aspects ${input.config.assignments.map((a) => a.aspect).join(",")}`,
  ].join(" ");
}
