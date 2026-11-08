import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  autocomplete,
  type CANCEL_SYMBOL,
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  select,
} from "@clack/prompts";
import type { Agent, Identity } from "../../../config/types.ts";
import type { SkillInstall } from "../../../install/plan.ts";
import type { InstallationScope } from "../../../install/targets.ts";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import { StateError } from "../../../util/errors.ts";
import type { Factory } from "../../factory.ts";
import type { Catalog } from "./catalog.ts";

function detectedHarnesses(f: Factory): Agent[] {
  const directories = (f.env.PATH ?? "").split(":").filter(isAbsolute);
  return AGENTS.filter((agent) =>
    directories.some((directory) =>
      HARNESSES[agent].executables.some((name) => {
        const file = join(directory, name);
        try {
          accessSync(file, constants.X_OK);
          return statSync(file).isFile();
        } catch {
          return false;
        }
      }),
    ),
  );
}

function answered<T>(value: T | typeof CANCEL_SYMBOL): T {
  if (isCancel(value))
    throw new StateError("decision-required", "Installation cancelled.");
  return value;
}

export async function configureTerminal(
  f: Factory,
  options: {
    agent: Agent | undefined;
    model: string | undefined;
    previous: Identity | undefined;
    harnesses: Agent[] | undefined;
    scope: InstallationScope;
    skillInstall: SkillInstall | undefined;
  },
  load: (agent: Agent, signal: AbortSignal) => Promise<Catalog>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  f.signals.once("SIGINT", abort);
  f.signals.once("SIGTERM", abort);
  const terminal = { output: f.io.error, signal: controller.signal };
  try {
    const detected = detectedHarnesses(f);
    const targets = [...new Set([...detected, ...(options.harnesses ?? [])])];
    if (!targets.length)
      throw new StateError(
        "environment-blocked",
        `No supported agent CLI (${AGENTS.join(", ").replace(/, ([^,]*)$/, " or $1")}) found in PATH. Install and log in to one, then rerun degreaser-axi init.`,
      );
    intro("Degreaser", terminal);
    const harnesses = answered(
      await multiselect({
        ...terminal,
        message: "Which agents do you want to install to?",
        options: targets.map((value) => ({
          value,
          label: HARNESSES[value].displayName,
        })),
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
    const skillInstall: SkillInstall =
      harnesses.some((a) => HARNESSES[a].integration.skill === "native") &&
      harnesses.some((a) => HARNESSES[a].integration.skill === "shared")
        ? answered(
            await select<SkillInstall>({
              ...terminal,
              message: "How should Claude Code get the Degreaser skill?",
              options: [
                {
                  value: "link",
                  label: "Symlink",
                  hint: "to the .agents/skills copy Codex, Pi and Cursor read",
                },
                { value: "copy", label: "Copy", hint: "separate file" },
              ],
              initialValue: options.skillInstall ?? "link",
            }),
          )
        : "copy";
    const cache = new Map<Agent, Catalog>();
    const catalog = async (agent: Agent) => {
      let result = cache.get(agent);
      if (!result) {
        // Clack's spinner exits 0 on Ctrl+C, bypassing adapter cleanup.
        log.step(`Loading ${HARNESSES[agent].displayName} models…`, terminal);
        result = await load(agent, controller.signal);
        cache.set(agent, result);
      }
      if (controller.signal.aborted)
        throw new StateError("decision-required", "Installation cancelled.");
      if (!result.candidates.length)
        throw new StateError(
          "environment-blocked",
          `${HARNESSES[agent].displayName} is unavailable: ${
            result.discovery.find((d) => d.agent === agent)?.reason ??
            "it returned no models."
          } Choose another agent or fix this, then rerun degreaser-axi init.`,
        );
      return result;
    };
    const previous =
      !options.model || options.previous?.model === options.model
        ? options.previous
        : undefined;
    const preferred = options.model
      ? undefined
      : [...AGENTS]
          .sort(
            (a, b) =>
              HARNESSES[a].recommendationPriority -
              HARNESSES[b].recommendationPriority,
          )
          .find(
            (value) =>
              detected.includes(value) &&
              HARNESSES[value].recommendationPriority < 2,
          );
    const defaultAgent =
      options.agent ?? previous?.agent ?? preferred ?? detected[0];
    if (!defaultAgent)
      throw new StateError("environment-blocked", "No review agent available.");
    const available = options.agent
      ? [options.agent]
      : [...new Set([...detected, defaultAgent])];
    const agent =
      available.length > 1
        ? answered(
            await select<Agent>({
              ...terminal,
              message: "Which agent should run the reviews?",
              options: available.map((value) => ({
                value,
                label: HARNESSES[value].displayName,
              })),
              initialValue: defaultAgent,
            }),
          )
        : defaultAgent;
    const choices = await catalog(agent);
    const models = choices.candidates.filter(
      (candidate) => !options.model || candidate.model === options.model,
    );
    const first = models[0];
    if (!first)
      throw new StateError("environment-blocked", "No matching models.");
    const current =
      options.previous?.agent === agent ? options.previous.model : undefined;
    if (
      current &&
      !options.model &&
      !models.some((candidate) => candidate.model === current)
    )
      log.warn(
        `Previous model ${current} is no longer available from ${HARNESSES[agent].displayName}. Choose another one.`,
        terminal,
      );
    const recommended = choices.recommendation?.model;
    const prefill = [options.model, current, recommended].find((model) =>
      models.some((candidate) => candidate.model === model),
    );
    const model = answered(
      await autocomplete({
        ...terminal,
        message: "Which model should run the reviews?",
        placeholder: "Search models",
        options: models.map((candidate) => {
          const hint = [
            candidate.model === current && "current",
            candidate.model === recommended && "recommended",
          ]
            .filter(Boolean)
            .join(", ");
          return {
            value: candidate.model,
            label: candidate.model,
            ...(hint ? { hint } : {}),
          };
        }),
        initialValue: prefill ?? first.model,
        maxItems: 6,
      }),
    );
    const identity: Identity = { agent, model };
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
    return { identity, harnesses, scope, skillInstall, choices };
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof StateError && error.code === "decision-required")
    ) {
      cancel("Installation cancelled.", terminal);
      return;
    }
    throw error;
  } finally {
    controller.abort();
    f.signals.removeListener("SIGINT", abort);
    f.signals.removeListener("SIGTERM", abort);
  }
}
