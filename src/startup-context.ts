import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  missingConfigFields,
  type ProjectConfig,
  resolveConfig,
} from "./config.ts";
import { InputError } from "./input-error.ts";
import { loadRun, StateError } from "./storage.ts";

export function startupContext(cwd: string): string {
  const git = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"],
    {
      cwd,
      encoding: "utf8",
      timeout: 500,
      maxBuffer: 8192,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith("GIT_"),
          ),
        ),
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if (git.status !== 0) return "";
  const root = git.stdout.trimEnd();
  const intro = "Degreaser reviews code changes with focused reviewers.";
  // User-wide hooks run in every repository; unconfigured ones stay silent.
  if (!existsSync(join(root, ".degreaserrc.json"))) return "";
  let config: ProjectConfig;
  try {
    config = loadConfig(root);
    resolveConfig(config);
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
  if (missingConfigFields(config).length)
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
