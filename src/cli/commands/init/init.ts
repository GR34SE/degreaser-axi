import { ASPECT_IDS } from "../../../modules/aspect/api.ts";
import type { CommandOptions, CommandResult } from "../../types.ts";
import { type Catalog, catalog } from "./catalog.ts";
import {
  confirmReplace,
  decisionRequired,
  installedView,
} from "./presentation.ts";
import { sameIdentity } from "./recommend.ts";

export { spec } from "./spec.ts";

import { join } from "node:path";
import { completeConfig } from "../../../config/defaults.ts";
import { readConfigText } from "../../../config/load.ts";
import { resolveConfig } from "../../../config/resolve.ts";
import type { Agent, Identity, ProjectConfig } from "../../../config/types.ts";
import { validateConfig } from "../../../config/validate.ts";
import { ensureStateIgnored } from "../../../install/gitignore.ts";
import {
  prepareIntegrations,
  type SkillInstall,
} from "../../../install/plan.ts";
import {
  type InstallationScope,
  skillInstallChoice,
} from "../../../install/targets.ts";
import { AGENTS, isAgent } from "../../../modules/harness/api.ts";
import { assertNotWorker } from "../../../modules/harness/common/isolation.ts";
import {
  InputError,
  IntegrationConflict,
  StateError,
} from "../../../util/errors.ts";
import { atomicWrite } from "../../../util/fs/atomic.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import { json } from "../../../util/json.ts";
import type { Factory } from "../../factory.ts";

const agents: Agent[] = [...AGENTS];
function agentChoice(value: string): Agent {
  if (!isAgent(value))
    throw new InputError(
      `Choose ${AGENTS.join(", ").replace(/, ([^,]*)$/, " or $1")}.`,
    );
  return value;
}

function harnessChoices(value: string): Agent[] {
  const selected = value.split(",").map((item) => agentChoice(item.trim()));
  if (new Set(selected).size !== selected.length)
    throw new InputError(
      "--harnesses must be a nonempty selection without duplicates.",
    );
  return selected;
}

export async function run(
  f: Factory,
  { values }: CommandOptions,
): Promise<CommandResult> {
  assertNotWorker(f.env, "initialize Degreaser");
  const agent =
    values.agent === undefined ? undefined : agentChoice(String(values.agent));
  const model = values.model === undefined ? undefined : String(values.model);
  if (
    model !== undefined &&
    (!model || /[\s\0]/.test(model) || model.startsWith("-"))
  )
    throw new InputError("--model must be an exact nonempty model ID.");
  let harnesses =
    values.harnesses === undefined
      ? undefined
      : harnessChoices(String(values.harnesses));
  const requestedScope = values["installation-scope"] ?? "project";
  if (requestedScope !== "project" && requestedScope !== "user")
    throw new InputError("--installation-scope must be project or user.");
  let scope: InstallationScope = requestedScope;
  const requestedSkillInstall =
    values["skill-install"] === undefined
      ? undefined
      : skillInstallChoice(values);
  let skillInstall: SkillInstall = requestedSkillInstall ?? "copy";
  const repository = repositoryRoot(f, f.cwd);
  const path = join(repository, ".degreaserrc.json");
  const before = readConfigText(path);
  let previous: ProjectConfig | undefined;
  if (before !== null) {
    try {
      previous = validateConfig(JSON.parse(before));
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError("Root .degreaserrc.json must contain valid JSON.");
    }
  }
  const tty = f.io.interactive;
  let choices: Catalog;
  let identity: Identity | undefined =
    agent && model ? { agent, model } : undefined;
  if (tty) {
    const { configureTerminal } = await import("./prompts.ts");
    const selected = await configureTerminal(
      f,
      {
        agent,
        model,
        previous,
        harnesses,
        scope,
        skillInstall: requestedSkillInstall,
      },
      (selectedAgent, signal) =>
        catalog(f, repository, [selectedAgent], signal),
    );
    if (!selected) return { output: "", exitCode: 2 };
    identity = selected.identity;
    harnesses = selected.harnesses;
    scope = selected.scope;
    skillInstall = selected.skillInstall;
    choices = selected.choices;
  } else {
    choices = await catalog(f, repository, agent ? [agent] : agents);
  }
  if (!tty && (!agent || !model || !harnesses)) {
    return {
      output: decisionRequired(
        choices,
        previous,
        agent,
        model,
        harnesses,
        scope,
      ),
      exitCode: 2,
    };
  }
  if (!identity || !harnesses)
    throw new InputError("Explicit model and harness decisions are required.");
  if (!choices.candidates.some((c) => sameIdentity(c, identity))) {
    const discovery = choices.discovery.find((d) => d.agent === identity.agent);
    if (discovery?.status === "unavailable")
      throw new StateError("environment-blocked", discovery.reason);
    throw new InputError(
      "Selected agent/model is not a listed model or latest selector. No substitute was selected.",
    );
  }
  const config = completeConfig(
    {
      ...previous,
      schemaVersion: 1,
      agent: identity.agent,
      model: identity.model,
    },
    ASPECT_IDS,
  );
  resolveConfig(config, {}, ASPECT_IDS);
  if (readConfigText(path) !== before)
    throw new StateError(
      "input-changed",
      ".degreaserrc.json changed during init. Rerun init to confirm the current configuration.",
    );
  const text = json(config);
  const replace = new Set<string>();
  let integrations: ReturnType<typeof prepareIntegrations>;
  for (;;) {
    try {
      integrations = prepareIntegrations(f, repository, harnesses, scope, {
        skillInstall,
        replace,
      });
      break;
    } catch (error) {
      if (
        !tty ||
        !(error instanceof IntegrationConflict) ||
        !error.replaceable ||
        replace.has(error.path)
      )
        throw error;
      if (!(await confirmReplace(f, error.path, repository)))
        throw new StateError(
          "decision-required",
          `Kept ${error.path}. Nothing was installed; preserve your edits, then rerun init.`,
        );
      replace.add(error.path);
    }
  }
  const ignore = ensureStateIgnored(f, repository);
  let installed = false;
  try {
    integrations.apply();
    installed = true;
    if (readConfigText(path) !== before)
      throw new StateError(
        "input-changed",
        ".degreaserrc.json changed during installation; the new content was preserved.",
      );
    if (text !== before) atomicWrite(path, text);
  } catch (error) {
    if (!(error instanceof StateError || error instanceof InputError))
      throw error;
    return {
      output: {
        error: error.message,
        code: "init-incomplete",
        cause: error.code,
        configuration: "unchanged",
        ignore: "Shared root ignore is in place; the index is unchanged.",
        integrations: installed
          ? integrations.results
          : "Not installed; integration writes were rolled back.",
        help: [
          "Resolve the reported failure, then rerun init with freshly confirmed model and harness choices.",
        ],
      },
      exitCode: 2,
    };
  }
  return {
    output: await installedView(
      f,
      repository,
      path,
      integrations,
      ignore,
      identity,
      harnesses,
      scope,
      choices,
    ),
  };
}
