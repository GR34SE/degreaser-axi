import { inspectAgentModels } from "acpx/runtime";
import type { Identity } from "./config.ts";
import { diagnoseFailure } from "./diagnostics.ts";
import { isolatedCommand } from "./native-environment.ts";
import { nativeProfile } from "./native-profile.ts";

/** Metadata only: no prompt, model setter, runtime store or review attempt. */
export async function discoverModels(
  identity: Pick<Identity, "agent"> & Partial<Pick<Identity, "model">>,
  cwd: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
) {
  try {
    const profile = await nativeProfile(
      { ...identity, model: identity.model ?? "" },
      "model-discovery",
      signal,
    );
    const models = await inspectAgentModels({
      agentCommand: isolatedCommand(profile),
      agentProcessEnvAllow: [],
      cwd,
      timeoutMs,
      ...(signal ? { signal } : {}),
    });
    if (!models) throw new Error("Missing model metadata.");
    return models;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw diagnoseFailure(
      error,
      `${identity.agent} model metadata discovery (no review started or substitute selected)`,
    );
  }
}
