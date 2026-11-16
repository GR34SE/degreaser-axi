import { ASPECT_IDS } from "../../../modules/aspect/api.ts";
import type { CommandOptions, CommandResult } from "../../types.ts";
import { type Catalog, catalog } from "./catalog.ts";
import {
  confirmReplace,
  decisionRequired,
  installedView,
  resolvedVerifier,
} from "./presentation.ts";
import { sameIdentity } from "./recommend.ts";

export { spec } from "./spec.ts";

import { join } from "node:path";
import { completeConfig } from "../../../config/defaults.ts";
import { readConfigText } from "../../../config/load.ts";
import { resolveConfig, unsupportedModel } from "../../../config/resolve.ts";
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

function modelChoice(value: unknown, flag: string) {
  if (value === undefined) return undefined;
  const model = String(value);
  if (!model || /[\s\0]/.test(model) || model.startsWith("-"))
    throw new InputError(
      `${flag} must be a nonempty model ID or latest selector.`,
    );
  return model;
}

function listedOrThrow(choices: Catalog, identity: Identity) {
  if (choices.candidates.some((c) => sameIdentity(c, identity))) return;
  const discovery = choices.discovery.find((d) => d.agent === identity.agent);
  if (discovery?.status === "unavailable")
    throw new StateError("environment-blocked", discovery.reason);
  throw unsupportedModel(
    identity,
    choices.candidates
      .filter((c) => c.agent === identity.agent)
      .map((c) => c.model),
  );
}

function verifierEntry(worker: Identity, verifier: Identity) {
  return verifier.agent === worker.agent
    ? { model: verifier.model }
    : { agent: verifier.agent, model: verifier.model };
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
  const model = modelChoice(values.model, "--model");
  const verifierAgent =
    values["verifier-agent"] === undefined
      ? undefined
      : agentChoice(String(values["verifier-agent"]));
  const verifierModel = modelChoice(
    values["verifier-model"],
    "--verifier-model",
  );
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
  const requested = { agent, model, verifierAgent, verifierModel };
  let identity: Identity | undefined =
    agent && model ? { agent, model } : undefined;
  let verifier = resolvedVerifier(requested);
  if (tty) {
    const { configureTerminal } = await import("./prompts.ts");
    const selected = await configureTerminal(
      f,
      {
        agent,
        model,
        verifierAgent,
        verifierModel,
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
    verifier = selected.verifier;
    harnesses = selected.harnesses;
    scope = selected.scope;
    skillInstall = selected.skillInstall;
    choices = selected.choices;
  } else {
    choices = await catalog(
      f,
      repository,
      agent ? [...new Set([agent, verifierAgent ?? agent])] : agents,
    );
  }
  if (!tty && (!identity || !verifier || !harnesses)) {
    return {
      output: decisionRequired(
        choices,
        previous,
        { ...requested, harnesses },
        scope,
      ),
      exitCode: 2,
    };
  }
  if (!identity || !verifier || !harnesses)
    throw new InputError(
      "Explicit model, verifier and harness decisions are required.",
    );
  listedOrThrow(choices, identity);
  listedOrThrow(choices, verifier);
  const config = completeConfig(
    {
      ...previous,
      schemaVersion: 1,
      agent: identity.agent,
      model: identity.model,
      verifier: verifierEntry(identity, verifier),
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
      verifier,
      harnesses,
      scope,
      choices,
    ),
  };
}
