import { diagnoseFailure } from "../../../util/diagnostics.ts";
import type { Runtime } from "../../../util/exec/types.ts";
import { type Agent, HARNESSES } from "../api.ts";
import type { Identity } from "../types.ts";

/** Metadata only: no prompt, model setter, runtime store or review attempt. */
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
