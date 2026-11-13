import type { Agent, Identity } from "../../../config/types.ts";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import {
  discoverModels,
  modelChoices,
} from "../../../modules/harness/common/models.ts";
import { DiagnosticError, StateError } from "../../../util/errors.ts";
import type { Factory } from "../../factory.ts";
import { recommend } from "./recommend.ts";

export interface Candidate extends Identity {
  account: string;
  label: string;
}

export interface Catalog {
  candidates: Candidate[];
  discovery: {
    agent: Agent;
    status: string;
    reason: string;
    notice?: string;
  }[];
  recommendation: Identity | null;
}
export async function catalog(
  f: Factory,
  cwd: string,
  selected: Agent[] = AGENTS,
  signal?: AbortSignal,
) {
  const candidates: Candidate[] = [];
  const discovery: {
    agent: Agent;
    status: string;
    reason: string;
    notice?: string;
  }[] = [];
  for (const agent of selected) {
    try {
      const models = await discoverModels(f, { agent }, cwd, 120_000, signal);
      const ids = [...new Set(models.availableModelIds)];
      if (ids.length === 0)
        throw new StateError(
          "environment-blocked",
          `No ${agent} models were advertised.`,
        );
      for (const { model, label } of modelChoices(agent, ids))
        candidates.push({
          agent,
          model,
          account: HARNESSES[agent].subscription(model),
          label,
        });
      discovery.push({
        agent,
        status: "discovered",
        reason: "Native model metadata; no inference.",
        ...(models.versionNotice ? { notice: models.versionNotice } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof StateError || error instanceof DiagnosticError))
        throw error;
      discovery.push({
        agent,
        status: "unavailable",
        reason:
          error instanceof DiagnosticError
            ? [error.message, ...error.help].join(" ")
            : error.message,
      });
    }
  }
  return { candidates, discovery, recommendation: recommend(candidates) };
}
