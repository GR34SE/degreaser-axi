import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, missingConfigFields, resolveConfig } from "./config.ts";
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
  if (!existsSync(join(root, ".degreaserrc.json"))) {
    return `${intro}\nNot configured in this repository. Use degreaser-axi --help.`;
  }
  const config = loadConfig(root);
  resolveConfig(config);
  const model = Array.from(config.model.slice(0, 200), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const lines = [intro, `Review model: ${config.agent}/${model}.`];
  const missing = missingConfigFields(config);
  if (missing.length) {
    const fields = missing.map(({ field, value }) => `${field}=${value}`);
    lines.push(
      `Missing settings use installed defaults (RC unchanged): ${fields.join(", ")}. Run degreaser-axi config sync to persist them.`,
    );
  }
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
  lines.push("Use degreaser-axi --help for review instructions.");
  return lines.join("\n");
}
