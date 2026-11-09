import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { ValidateFunction } from "ajv";
import type { ReviewInput } from "../review/types.ts";
import { InputError, StateError } from "../util/errors.ts";
import { atomicWrite } from "../util/fs/atomic.ts";
import { hash } from "../util/hash.ts";
import { json } from "../util/json.ts";
import { reviewIdentity } from "./identity.ts";
import { type Run, resolved, terminalStatus } from "./run.ts";
import { stateSchema } from "./schema.ts";

const runSchema = () => stateSchema<Run>("run");
const inputSchema = () => stateSchema<ReviewInput>("input");
const patchSchema = () => stateSchema<string | null>("patch");
const stateIndexSchema = () =>
  stateSchema<{ schemaVersion: 1; latestRunId: string }>("state");

export function statePath(repository: string, ...parts: string[]) {
  const root = join(repository, ".degreaser");
  const target = join(root, ...parts);
  const segments = relative(repository, target).split("/");
  let path = repository;
  for (const segment of segments) {
    if (segment === "..")
      throw new StateError(
        "invalid-input",
        "State path escapes this repository.",
      );
    path = join(path, segment);
    try {
      if (lstatSync(path).isSymbolicLink())
        throw new StateError("state-unsafe", `Refusing symlink state: ${path}`);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
  }
  return target;
}
export function runDirectory(repository: string, id: string) {
  if (!/^r-\d{8}-\d{4}-[a-f0-9]{4}$/.test(id))
    throw new InputError("Invalid run ID.");
  return statePath(repository, "runs", id);
}
export function checked<T>(
  value: unknown,
  schema: ValidateFunction<T>,
  path: string,
): T {
  if (!schema(value))
    throw new StateError(
      "state-corrupt",
      `Invalid or unsupported state: ${path}`,
    );
  return value;
}
function readState(path: string, format: "json" | "text" = "json"): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const text = readFileSync(fd, "utf8");
    return format === "json" ? JSON.parse(text) : text;
  } catch {
    throw new StateError(
      "state-corrupt",
      `Unreadable or malformed state: ${path}`,
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function writeJson<T>(
  path: string,
  value: unknown,
  schema: ValidateFunction<T>,
) {
  checked(value, schema, path);
  atomicWrite(path, json(value));
}
export function saveRun(run: Run) {
  runDirectory(run.repository, run.id);
  const path = statePath(run.repository, "runs", run.id, "run.json");
  checkedRun(run, path, run.repository, run.id);
  if (existsSync(path))
    checkedRun(readState(path), path, run.repository, run.id);
  atomicWrite(path, json(run));
}
export function loadRun(repository: string, requested?: string): Run {
  let id = requested;
  if (!id) {
    const path = statePath(repository, "state.json");
    if (!existsSync(path))
      throw new StateError(
        "no-history",
        "No local review history in this repository.",
      );
    id = checked(readState(path), stateIndexSchema(), path).latestRunId;
  }
  const path = join(runDirectory(repository, id), "run.json");
  statePath(repository, "runs", id, "run.json");
  if (!existsSync(path))
    throw new StateError("run-not-found", `Run not found: ${path}`);
  return checkedRun(readState(path), path, repository, id);
}
function checkedRun(
  value: unknown,
  path: string,
  repository: string,
  id: string,
): Run {
  const run = checked(value, runSchema(), path);
  if (run.repository !== repository)
    throw new StateError(
      "foreign-run",
      `Run ${id} was recorded for ${run.repository}, not this repository (moved or copied). Start a new review here.`,
    );
  if (
    run.id !== id ||
    new Set(run.tasks.map((t) => t.assignment.aspect)).size !==
      run.tasks.length ||
    run.tasks.some(
      (t) =>
        ((resolved(t) || t.status === "incomplete") && !t.result) ||
        t.attempts.some(
          (a) => a.result && a.result.aspect !== t.assignment.aspect,
        ) ||
        (t.result &&
          (t.result.aspect !== t.assignment.aspect ||
            (t.result.status !== t.status &&
              !(t.result.status === "incomplete" && !resolved(t))))),
    ) ||
    (run.status !== "running" && run.status !== terminalStatus(run.tasks))
  )
    throw new StateError(
      "state-corrupt",
      `Inconsistent run identity/results: ${path}`,
    );
  return run;
}
export function loadInput(run: Run): ReviewInput {
  const path = statePath(
    run.repository,
    "runs",
    run.id,
    "input",
    "review.json",
  );
  try {
    const input = checked(readState(path), inputSchema(), path);
    if (input.repository !== run.repository)
      throw new Error("Repository mismatch");
    if (
      JSON.stringify(run.tasks.map((t) => t.assignment)) !==
      JSON.stringify(input.config.assignments)
    )
      throw new Error("Assignment identity mismatch");
    const prompts = run.tasks.map((t) => t.promptHash);
    if (
      reviewIdentity(input, prompts) !== run.identity &&
      hash(JSON.stringify({ input, prompts })) !== run.identity
    )
      throw new Error("Input identity mismatch");
    const patch = statePath(
      run.repository,
      "runs",
      run.id,
      "input",
      "patch.json",
    );
    if (checked(readState(patch), patchSchema(), patch) !== input.patch)
      throw new StateError(
        "state-corrupt",
        `Patch differs from persisted scope: ${patch}`,
      );
    if (input.patch !== null) {
      const rawPatch = statePath(
        run.repository,
        "runs",
        run.id,
        "input",
        "patch.diff",
      );
      if (readState(rawPatch, "text") !== input.patch)
        throw new StateError(
          "state-corrupt",
          `Patch differs from persisted scope: ${rawPatch}`,
        );
    }
    return input;
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError("state-corrupt", `Invalid persisted input: ${path}`);
  }
}
export function checkHistory(repository: string) {
  if (!existsSync(statePath(repository, "state.json"))) return;
  try {
    loadInput(loadRun(repository));
  } catch (error) {
    if (!(error instanceof StateError && error.code === "foreign-run"))
      throw error;
  }
}
