import { existsSync } from "node:fs";
import { join } from "node:path";
import { configNotice } from "../../../config/defaults.ts";
import {
  CALLER_GUIDANCE,
  DESCRIPTION,
} from "../../../install/skill/guidance.ts";
import { ASPECT_IDS } from "../../../modules/aspect/api.ts";
import { observedStatus } from "../../../state/status.ts";
import { loadInput, loadRun } from "../../../state/store.ts";
import { InputError, StateError } from "../../../util/errors.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";

export { spec } from "./spec.ts";

export function run(f: Factory) {
  let exitCode: number | undefined;
  const local: Record<string, unknown> = {
    // The SDK header renderer is not exported from its public entry point.
    bin: f.bin.startsWith(`${f.home}/`)
      ? `~${f.bin.slice(f.home.length)}`
      : f.bin,
    description: DESCRIPTION,
    configuration: "unconfigured",
    history: "unavailable",
    status: "unconfigured",
    commands: f.commandNames,
    guidance: CALLER_GUIDANCE,
    help: ["degreaser-axi review --help", "degreaser-axi init --help"],
  };
  let repository: string;
  try {
    repository = repositoryRoot(f, f.cwd);
  } catch {
    return {
      output: { ...local, reason: "Local repository context is unavailable." },
    };
  }
  try {
    const config = f.config(repository);
    Object.assign(local, {
      ...configNotice(config, ASPECT_IDS),
      configuration: "configured",
      status: "configured",
      agent: config.agent,
      model: config.model,
    });
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    if (existsSync(join(repository, ".degreaserrc.json"))) {
      exitCode = 2;
      local.configuration = "invalid";
    }
    local.reason = error.message;
  }
  try {
    const run = loadRun(repository);
    loadInput(run);
    const status = observedStatus(run);
    Object.assign(local, {
      history: "available",
      run: run.id,
      status,
      next: `degreaser-axi ${status === "running" ? "wait" : "report"} ${run.id}`,
      help: [
        `degreaser-axi ${status === "running" ? "wait" : "report"} ${run.id}`,
        "degreaser-axi review --help",
      ],
    });
  } catch (error) {
    if (!(error instanceof StateError || error instanceof InputError))
      throw error;
    if (error.code !== "no-history") exitCode = 2;
    local.history = error.code;
    local.historyReason = error.message;
  }
  return { output: local, ...(exitCode === undefined ? {} : { exitCode }) };
}
