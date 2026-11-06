import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  autocomplete,
  type CANCEL_SYMBOL,
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  select,
} from "@clack/prompts";
import type { Agent, Identity } from "./config.ts";
import type { Catalog } from "./init.ts";
import type { InstallationScope } from "./integration-targets.ts";
import { StateError } from "./storage.ts";

const names = { codex: "Codex", claude: "Claude Code", pi: "Pi" };
const agents: Agent[] = ["codex", "claude", "pi"];

function detectedHarnesses(): Agent[] {
  const directories = (process.env.PATH ?? "").split(":").filter(isAbsolute);
  return agents.filter((agent) =>
    directories.some((directory) => {
      const file = join(directory, agent);
      try {
        accessSync(file, constants.X_OK);
        return statSync(file).isFile();
      } catch {
        return false;
      }
    }),
  );
}

function answered<T>(value: T | typeof CANCEL_SYMBOL): T {
  if (isCancel(value))
    throw new StateError("decision-required", "Installation cancelled.");
  return value;
}

export async function configureTerminal(
  options: {
    agent: Agent | undefined;
    model: string | undefined;
    previous: Identity | undefined;
    harnesses: Agent[] | undefined;
    scope: InstallationScope;
  },
  load: (agent: Agent, signal: AbortSignal) => Promise<Catalog>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const terminal = { output: process.stderr, signal: controller.signal };
  try {
    const detected = detectedHarnesses();
    const targets = [...new Set([...detected, ...(options.harnesses ?? [])])];
    if (!targets.length)
      throw new StateError(
        "environment-blocked",
        "No supported harnesses found in PATH.",
      );
    intro("Degreaser", terminal);
    const harnesses = answered(
      await multiselect({
        ...terminal,
        message: "Which agents do you want to install to?",
        options: targets.map((value) => ({ value, label: names[value] })),
        initialValues: options.harnesses ?? detected,
        required: true,
      }),
    );
    const scope = answered(
      await select({
        ...terminal,
        message: "Installation scope",
        options: [
          { value: "project" as const, label: "Project", hint: "This project" },
          { value: "user" as const, label: "Global", hint: "All projects" },
        ],
        initialValue: options.scope,
      }),
    );
    const cache = new Map<Agent, Catalog>();
    const catalog = async (agent: Agent) => {
      let result = cache.get(agent);
      if (!result) {
        result = await load(agent, controller.signal);
        cache.set(agent, result);
      }
      if (controller.signal.aborted)
        throw new StateError("decision-required", "Installation cancelled.");
      const first = result.candidates[0];
      if (!first)
        throw new StateError(
          "environment-blocked",
          `${names[agent]} returned no models. Log in to it or choose another agent, then rerun degreaser init.`,
        );
      return {
        ...result,
        defaultModel: result.recommendation?.model ?? first.model,
      };
    };
    const previous =
      !options.model || options.previous?.model === options.model
        ? options.previous
        : undefined;
    const agent = options.agent ?? previous?.agent ?? detected[0];
    if (!agent)
      throw new StateError("environment-blocked", "No review agent available.");
    let choices = await catalog(agent);
    let identity: Identity = {
      agent,
      model:
        options.model ??
        (options.previous?.agent === agent
          ? options.previous.model
          : undefined) ??
        choices.defaultModel,
    };
    const selection = answered(
      await select({
        ...terminal,
        message: "Review model",
        options: [
          {
            value: "keep",
            label: `${names[identity.agent]} / ${identity.model}`,
          },
          { value: "change", label: "Choose another model" },
        ],
        initialValue: "keep",
      }),
    );
    if (selection === "change") {
      const available = options.agent
        ? [options.agent]
        : [...new Set([...detected, identity.agent])];
      const chosenAgent = answered(
        await select<Agent>({
          ...terminal,
          message: "Agent",
          options: available.map((value) => ({ value, label: names[value] })),
          initialValue: identity.agent,
        }),
      );
      choices = await catalog(chosenAgent);
      const models = choices.candidates.filter(
        (candidate) => !options.model || candidate.model === options.model,
      );
      const first = models[0];
      if (!first)
        throw new StateError("environment-blocked", "No matching models.");
      const recommended = choices.recommendation?.model;
      const model = answered(
        await autocomplete({
          ...terminal,
          message: "Model",
          placeholder: "Search models",
          options: models.map((candidate) => ({
            value: candidate.model,
            label: candidate.model,
            ...(candidate.model === recommended ? { hint: "recommended" } : {}),
          })),
          initialValue:
            chosenAgent === identity.agent &&
            models.some((candidate) => candidate.model === identity.model)
              ? identity.model
              : (models.find((candidate) => candidate.model === recommended)
                  ?.model ?? first.model),
          maxItems: 6,
        }),
      );
      identity = { agent: chosenAgent, model };
    }
    if (
      !answered(
        await confirm({
          ...terminal,
          message: "Proceed with installation?",
          initialValue: true,
        }),
      )
    )
      throw new StateError("decision-required", "Installation cancelled.");
    return { identity, harnesses, scope, choices };
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof StateError && error.code === "decision-required")
    ) {
      cancel("Installation cancelled.", terminal);
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    controller.abort();
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
