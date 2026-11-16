import {
  autocomplete,
  type CANCEL_SYMBOL,
  isCancel,
  log,
  select,
} from "@clack/prompts";
import type { Agent } from "../../../config/types.ts";
import { HARNESSES } from "../../../modules/harness/api.ts";
import { StateError } from "../../../util/errors.ts";
import type { Factory } from "../../factory.ts";
import type { Catalog } from "./catalog.ts";

export function answered<T>(value: T | typeof CANCEL_SYMBOL): T {
  if (isCancel(value))
    throw new StateError("decision-required", "Installation cancelled.");
  return value;
}

type Terminal = { output: Factory["io"]["error"]; signal: AbortSignal };

export async function chooseModel(
  terminal: Terminal,
  choices: Catalog,
  agent: Agent,
  options: {
    message: string;
    flag: string | undefined;
    current: string | undefined;
    recommended: string | undefined;
  },
) {
  const { flag, current, recommended } = options;
  const models = choices.candidates.filter(
    (candidate) => !flag || candidate.model === flag,
  );
  const first = models[0];
  if (!first)
    throw new StateError("environment-blocked", "No matching models.");
  if (current && !flag && !models.some((c) => c.model === current))
    log.warn(
      `Previous model ${current} is no longer available from ${HARNESSES[agent].displayName}. Choose another one.`,
      terminal,
    );
  const prefill = [flag, current, recommended].find((model) =>
    models.some((candidate) => candidate.model === model),
  );
  return answered(
    await autocomplete({
      ...terminal,
      message: options.message,
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
          label: candidate.label,
          ...(hint ? { hint } : {}),
        };
      }),
      initialValue: prefill ?? first.model,
      maxItems: 6,
    }),
  );
}

export async function chooseAgent(
  terminal: Terminal,
  message: string,
  available: Agent[],
  initialValue: Agent,
) {
  return available.length > 1
    ? answered(
        await select<Agent>({
          ...terminal,
          message,
          options: available.map((value) => ({
            value,
            label: HARNESSES[value].displayName,
          })),
          initialValue,
        }),
      )
    : initialValue;
}
