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

interface ReviewRequest {
  scope: Scope;
  baseRef: string | undefined;
  task: string;
  taskFile?: string;
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
    if (token.kind !== "option") continue;
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
    `--aspects ${input.config.assignments.map((a) => a.aspect).join(",")}`,
  ].join(" ");
}
