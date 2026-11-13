import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ReviewInput } from "../review/types.ts";
import { InputError } from "../util/errors.ts";
import type { Runtime } from "../util/exec/types.ts";
import { atomicWrite } from "../util/fs/atomic.ts";
import { git } from "../util/git/exec.ts";
import { reviewIdentity } from "./identity.ts";
import type { Run, RunTask } from "./run.ts";
import { stateSchema } from "./schema.ts";
import {
  checked,
  checkHistory,
  runDirectory,
  saveRun,
  statePath,
  writeJson,
} from "./store.ts";

export function createRun(
  runtime: Runtime,
  input: ReviewInput,
  prepareTasks: (patchFile: string) => RunTask[],
): Run {
  checked(input, stateSchema<ReviewInput>("input"), "input/review.json");
  const root = statePath(input.repository);
  if (
    git(
      runtime,
      input.repository,
      ["check-ignore", "--no-index", ".degreaser/probe"],
      {
        allowFailure: (status) => status === 1,
      },
    ) === null
  )
    throw new InputError(
      "Ignore /.degreaser/ before review; local review artifacts may contain source code. Either commit the rule in the root .gitignore, or add it to the file printed by `git rev-parse --git-path info/exclude`, which stays out of commits and applies to every worktree of this repository.",
    );
  const latest = statePath(input.repository, "state.json");
  checkHistory(input.repository);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const runs = statePath(input.repository, "runs");
  mkdirSync(runs, { recursive: true, mode: 0o700 });
  const stamp = new Date(runtime.now()).toISOString().replace(/[-:]/g, "");
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
  const patchFile = join(dir, "input", "patch.diff");
  const tasks = prepareTasks(patchFile);
  const run: Run = {
    schemaVersion: 1,
    id,
    repository: input.repository,
    createdAt: runtime.now(),
    deadline: runtime.now() + input.config.limits.runTimeoutSeconds * 1000,
    status: "running",
    owner: null,
    identity: reviewIdentity(
      input,
      tasks.map((t) => t.promptHash),
    ),
    tasks,
  };
  writeJson(
    join(dir, "input", "review.json"),
    input,
    stateSchema<ReviewInput>("input"),
  );
  const patchJson = join(dir, "input", "patch.json");
  checked(input.patch, stateSchema<string | null>("patch"), patchJson);
  atomicWrite(patchJson, JSON.stringify(input.patch));
  if (input.patch !== null) atomicWrite(patchFile, input.patch);
  saveRun(run);
  writeJson(
    latest,
    { schemaVersion: 1, latestRunId: id },
    stateSchema<{ schemaVersion: 1; latestRunId: string }>("state"),
  );
  return run;
}
