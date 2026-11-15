import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  cancel,
  confirm,
  intro,
  log,
  multiselect,
  select,
} from "@clack/prompts";
import type { Agent, Identity, ProjectConfig } from "../../../config/types.ts";
import type { SkillInstall } from "../../../install/plan.ts";
import type { InstallationScope } from "../../../install/targets.ts";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import { StateError } from "../../../util/errors.ts";
import type { Factory } from "../../factory.ts";
import { type Catalog, mergeCatalogs } from "./catalog.ts";
import { answered, chooseAgent, chooseModel } from "./choose.ts";
import { byPriority, recommendVerifier } from "./recommend.ts";

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

export async function configureTerminal(
  f: Factory,
  options: {
    agent: Agent | undefined;
    model: string | undefined;
    verifierAgent: Agent | undefined;
    verifierModel: string | undefined;
    previous: ProjectConfig | undefined;
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
      : AGENTS.toSorted(byPriority).find(
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
    const agent = await chooseAgent(
      terminal,
      "Which agent should run the reviews?",
      available,
      defaultAgent,
    );
    const choices = await catalog(agent);
    const current =
      options.previous?.agent === agent ? options.previous.model : undefined;
    const model = await chooseModel(terminal, choices, agent, {
      message: "Which model should run the reviews?",
      flag: options.model,
      current,
      recommended: choices.recommendation?.model,
    });
    const previousVerifier = options.previous?.verifier && {
      agent: options.previous.verifier.agent ?? options.previous.agent,
      model: options.previous.verifier.model,
    };
    const verifierAvailable = options.verifierAgent
      ? [options.verifierAgent]
      : [...new Set([agent, ...detected])];
    const verifierAgent = await chooseAgent(
      terminal,
      "Which agent should verify findings?",
      verifierAvailable,
      options.verifierAgent ?? previousVerifier?.agent ?? agent,
    );
    const verifierChoices = await catalog(verifierAgent);
    const verifierModel = await chooseModel(
      terminal,
      verifierChoices,
      verifierAgent,
      {
        message: "Which model should verify findings?",
        flag: options.verifierModel,
        current:
          previousVerifier?.agent === verifierAgent
            ? previousVerifier.model
            : undefined,
        recommended: recommendVerifier(verifierChoices.candidates)?.model,
      },
    );
    const verifier: Identity = { agent: verifierAgent, model: verifierModel };
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
    return {
      identity,
      verifier,
      harnesses,
      scope,
      skillInstall,
      choices: mergeCatalogs(choices, verifierChoices),
    };
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
