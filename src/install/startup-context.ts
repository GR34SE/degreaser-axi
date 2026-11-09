import { existsSync } from "node:fs";
import { join } from "node:path";
import { missingConfigFields } from "../config/defaults.ts";
import { loadConfig } from "../config/load.ts";
import { resolveConfig } from "../config/resolve.ts";
import type { Assignment, ProjectConfig } from "../config/types.ts";
import { loadRun } from "../state/store.ts";
import { InputError, StateError } from "../util/errors.ts";
import { gitEnvironment } from "../util/exec/env.ts";
import type { Runtime } from "../util/exec/types.ts";

export function startupContext(
  cwd: string,
  runtime: Runtime,
  aspectIds: readonly Assignment["aspect"][],
): string {
  const git = runtime.spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"],
    {
      cwd,
      encoding: "utf8",
      timeout: 500,
      maxBuffer: 8192,
      env: {
        ...gitEnvironment(runtime.env),
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if (git.status !== 0) return "";
  const root = git.stdout.trimEnd();
  const intro = "Degreaser reviews code changes with focused reviewers.";
  if (!existsSync(join(root, ".degreaserrc.json"))) return "";
  let config: ProjectConfig;
  try {
    config = loadConfig(root);
    resolveConfig(config, {}, aspectIds);
  } catch (error) {
    if (error instanceof InputError)
      return "Degreaser config invalid; run degreaser-axi doctor";
    throw error;
  }
  const model = Array.from(config.model.slice(0, 200), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const lines = [intro, `Review model: ${config.agent}/${model}.`];
  if (missingConfigFields(config, aspectIds).length)
    lines.push(
      "Some settings use installed defaults; degreaser-axi config sync saves them.",
    );
  try {
    const run = loadRun(root);
    lines.push(`Last run: ${run.id} (${run.status}).`);
    lines.push(
      run.status === "running"
        ? `Use degreaser-axi wait ${run.id} until the run finishes.`
        : `Use degreaser-axi report ${run.id} to inspect the result.`,
    );
  } catch (error) {
    if (!(error instanceof StateError && error.code === "no-history"))
      throw error;
    lines.push("No local run yet.");
  }
  lines.push("Run degreaser-axi for review instructions and status.");
  return lines.join("\n");
}
