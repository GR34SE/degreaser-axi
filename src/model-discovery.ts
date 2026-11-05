import { inspectAgentModels } from "acpx/runtime";
import type { Identity } from "./config.ts";
import { isolatedCommand } from "./native-environment.ts";
import { nativeProfile } from "./native-profile.ts";
import { StateError } from "./storage.ts";

/** Metadata only: no prompt, model setter, runtime store or review attempt. */
export async function discoverModels(
  identity: Identity,
  cwd: string,
  timeoutMs = 120_000,
) {
  try {
    const profile = await nativeProfile(identity, "model-discovery");
    const models = await inspectAgentModels({
      agentCommand: isolatedCommand(profile),
      agentProcessEnvAllow: [],
      cwd,
      timeoutMs,
    });
    if (!models) throw new Error("Missing model metadata.");
    return models;
  } catch {
    throw new StateError(
      "environment-blocked",
      `Could not discover ${identity.agent} model metadata. Check the selected native harness version, subscription login and host permissions, then retry. No review started or substitute was selected.`,
    );
  }
}
