import { diagnoseFailure } from "../../../util/diagnostics.ts";
import type { Runtime } from "../../../util/exec/types.ts";
import { type Agent, HARNESSES } from "../api.ts";
import type { Identity, ModelChoice } from "../types.ts";

// AXI supplies prompts/output, not native model catalogs or rolling selectors.
export function modelChoices(
  agent: Agent,
  models: readonly string[],
): ModelChoice[] {
  const ids = [...new Set(models)];
  return (
    HARNESSES[agent].modelChoices?.(ids) ??
    ids.map((model) => ({ model, label: model, resolvedModel: model }))
  );
}

export async function discoverModels(
  runtime: Runtime,
  identity: Pick<Identity<Agent>, "agent"> & Partial<Pick<Identity, "model">>,
  cwd: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
) {
  try {
    return await HARNESSES[identity.agent].discoverModels(
      runtime,
      identity.model ?? "",
      cwd,
      timeoutMs,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw diagnoseFailure(
      error,
      `${identity.agent} model metadata discovery (no review started or substitute selected)`,
    );
  }
}
