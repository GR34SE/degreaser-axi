import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import type { Assignment } from "./config.ts";
import { git } from "./git.ts";
import type { ReviewInput } from "./input.ts";
import { InputError } from "./input-error.ts";
import { assemblePrompt, hash, reviewIdentity } from "./prompt.ts";
import type { Rejection, WorkerResult } from "./results.ts";

export interface RunTask {
  assignment: Assignment;
  promptHash: string | null;
  status:
    | "pending"
    | "running"
    | "failed"
    | "cancelled"
    | WorkerResult["status"];
  result: WorkerResult | null;
  rejections: Rejection[];
  attempts: {
    startedAt: number;
    endedAt: number | null;
    sessionId: string | null;
    failure: string | null;
    result?: WorkerResult | null;
    rejections?: Rejection[];
    limitations?: string[];
    usage?: Record<string, number> | null;
  }[];
  limitations: string[];
  usage: Record<string, number> | null;
}
export interface Run {
  schemaVersion: 1;
  id: string;
  repository: string;
  createdAt: number;
  deadline: number;
  status: "running" | "completed" | "partial" | "failed";
  owner: {
    pid: number;
    heartbeat: number;
    started?: string;
    processes?: ProcessIdentity[];
  } | null;
  executions?: {
    startedAt: number;
    deadline: number;
    concurrency: number | null;
    waitSeconds: number;
  }[];
  identity: string;
  tasks: RunTask[];
}
export interface ProcessIdentity {
  pid: number;
  started: string;
  group: number;
}
export const resolved = (task: RunTask) =>
  ["findings", "no-findings", "not-applicable"].includes(task.status);
export function terminalStatus(tasks: RunTask[]): Run["status"] {
  return tasks.every(resolved)
    ? "completed"
    : tasks.some((t) => t.result)
      ? "partial"
      : "failed";
}
export class StateError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
const ajv = new Ajv({ strict: true, allErrors: true });
for (const name of ["config", "input", "patch", "result", "run", "state"]) {
  ajv.addSchema(
    JSON.parse(
      readFileSync(
        new URL(`../assets/schemas/${name}-v1.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
}
function schema<T>(name: string): ValidateFunction<T> {
  const validate = ajv.getSchema<T>(
    `https://degreaser.dev/schemas/${name}-v1.json`,
  );
  if (!validate) throw new Error("Missing state schema.");
  return validate;
}
const runSchema = schema<Run>("run");
const inputSchema = schema<ReviewInput>("input");
const patchSchema = schema<string | null>("patch");
const stateSchema = schema<{ schemaVersion: 1; latestRunId: string }>("state");

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
export function atomicWrite(path: string, value: string) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    try {
      writeFileSync(temporary, value, { flag: "wx", mode: 0o600, flush: true });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  } catch {
    throw new StateError(
      "state-write-failed",
      `Could not atomically write state: ${path}`,
    );
  }
}
function checked<T>(
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
function readJson(path: string): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return JSON.parse(readFileSync(fd, "utf8"));
  } catch {
    throw new StateError(
      "state-corrupt",
      `Unreadable or malformed state: ${path}`,
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function writeJson<T>(
  path: string,
  value: unknown,
  schema: ValidateFunction<T>,
) {
  checked(value, schema, path);
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function saveRun(run: Run) {
  runDirectory(run.repository, run.id);
  const path = statePath(run.repository, "runs", run.id, "run.json");
  checkedRun(run, path, run.repository, run.id);
  if (existsSync(path))
    checkedRun(readJson(path), path, run.repository, run.id);
  atomicWrite(path, `${JSON.stringify(run, null, 2)}\n`);
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
    id = checked(readJson(path), stateSchema, path).latestRunId;
  }
  const path = join(runDirectory(repository, id), "run.json");
  statePath(repository, "runs", id, "run.json");
  if (!existsSync(path))
    throw new StateError("run-not-found", `Run not found: ${path}`);
  return checkedRun(readJson(path), path, repository, id);
}
function checkedRun(
  value: unknown,
  path: string,
  repository: string,
  id: string,
): Run {
  const run = checked(value, runSchema, path);
  if (run.repository !== repository)
    throw new StateError(
      "invalid-input",
      `Run belongs to another repository: ${path}`,
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
    const input = checked(readJson(path), inputSchema, path);
    if (input.repository !== run.repository)
      throw new Error("Repository mismatch");
    if (
      JSON.stringify(run.tasks.map((t) => t.assignment)) !==
      JSON.stringify(input.config.assignments)
    )
      throw new Error("Assignment identity mismatch");
    const prompts = run.tasks.map((t) => t.promptHash);
    // Keep earlier development results readable, but never migrate their evidence.
    // Resume requires the current fingerprint and recorded task source.
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
    if (checked(readJson(patch), patchSchema, patch) !== input.patch)
      throw new StateError(
        "state-corrupt",
        `Patch differs from persisted scope: ${patch}`,
      );
    return input;
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError("state-corrupt", `Invalid persisted input: ${path}`);
  }
}
export function checkHistory(repository: string) {
  if (existsSync(statePath(repository, "state.json")))
    loadInput(loadRun(repository));
}
export function createRun(input: ReviewInput): Run {
  checked(input, inputSchema, "input/review.json");
  const root = statePath(input.repository);
  if (
    git(input.repository, ["check-ignore", "--no-index", ".degreaser/probe"], {
      allowFailure: true,
    }) === null
  )
    throw new InputError(
      "Add /.degreaser/ to the root .gitignore before review. Local review artifacts may contain source code.",
    );
  const latest = statePath(input.repository, "state.json");
  checkHistory(input.repository);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const runs = statePath(input.repository, "runs");
  mkdirSync(runs, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "");
  let id: string, dir: string;
  for (;;) {
    id = `r-${stamp.slice(0, 8)}-${stamp.slice(9, 13)}-${randomBytes(2).toString("hex")}`;
    dir = runDirectory(input.repository, id);
    try {
      mkdirSync(dir, { mode: 0o700 });
      break;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
  }
  mkdirSync(join(dir, "input"), { mode: 0o700 });
  const patchFile = join(dir, "input", "patch.json");
  const tasks: RunTask[] = input.config.assignments.map((assignment) => {
    const result =
      input.coordinatorResults.find((r) => r.aspect === assignment.aspect) ??
      null;
    return {
      assignment,
      promptHash: result
        ? null
        : assemblePrompt(input, assignment.aspect, patchFile).promptHash,
      status: result?.status ?? "pending",
      result,
      rejections: [],
      attempts: [],
      limitations: [],
      usage: null,
    };
  });
  const run: Run = {
    schemaVersion: 1,
    id,
    repository: input.repository,
    createdAt: Date.now(),
    deadline: Date.now() + input.config.limits.runTimeoutSeconds * 1000,
    status: "running",
    owner: null,
    identity: reviewIdentity(
      input,
      tasks.map((t) => t.promptHash),
    ),
    tasks,
  };
  writeJson(join(dir, "input", "review.json"), input, inputSchema);
  const first = input.config.assignments[0];
  if (!first) throw new Error("Empty assignments");
  const patchData = assemblePrompt(input, first.aspect, patchFile).patchData;
  checked(JSON.parse(patchData), patchSchema, patchFile);
  atomicWrite(patchFile, patchData);
  saveRun(run);
  writeJson(latest, { schemaVersion: 1, latestRunId: id }, stateSchema);
  return run;
}
