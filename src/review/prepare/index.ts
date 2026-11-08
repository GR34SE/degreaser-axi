import { loadConfig } from "../../config/load.ts";
import { resolveConfig } from "../../config/resolve.ts";
import type { Assignment } from "../../config/types.ts";
import { ASPECT_IDS } from "../../modules/aspect/api.ts";
import { relevantDismissals } from "../../state/dismissals.ts";
import { InputError } from "../../util/errors.ts";
import type { Runtime } from "../../util/exec/types.ts";
import { repositoryRoot } from "../../util/git/repository.ts";
import { commandArgument as quote } from "../../util/shell.ts";
import type { ReviewInput, ReviewRequest } from "../types.ts";
import { resolveScope } from "./scope/resolve.ts";

export function prepareReview(
  runtime: Runtime,
  request: ReviewRequest,
  cwd: string,
  configLoader = loadConfig,
): ReviewInput {
  const repository = repositoryRoot(runtime, cwd);
  const config = resolveConfig(
    configLoader(repository),
    request.controls,
    ASPECT_IDS,
  );
  const scope = resolveScope(
    runtime,
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
  const dismissed = relevantDismissals(runtime, repository, scope.paths);
  const coordinatorResults =
    request.scope === "repository" &&
    config.assignments.some((a) => a.aspect === "scope-creep")
      ? [
          {
            aspect: "scope-creep" as const,
            status: "not-applicable" as const,
            findings: [],
            limitations: [],
            reason:
              "An explicit repository audit has no feature-change scope to assess for scope-creep.",
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
    ...(request.pathPatterns.length
      ? { pathPatterns: request.pathPatterns }
      : {}),
    waitSeconds: request.waitSeconds,
    config,
    ...(dismissed.length ? { dismissed } : {}),
    ...scope,
    workers,
    coordinatorResults,
  };
}

export function reviewCommand(input: ReviewInput) {
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
