import { inspectAgentModels } from "acpx/runtime";
import type { NativeProfile } from "../types.ts";
import { isolatedCommand } from "./isolation.ts";

export async function discoverProfileModels(
  profile: () => Promise<NativeProfile>,
  cwd: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
) {
  const resolved = await profile();
  const models = await inspectAgentModels({
    agentCommand: isolatedCommand(resolved),
    agentProcessEnvAllow: [],
    cwd,
    timeoutMs,
    ...(signal ? { signal } : {}),
  });
  if (!models) throw new Error("Missing model metadata.");
  return {
    ...models,
    ...(resolved.versionNotice
      ? { versionNotice: resolved.versionNotice }
      : {}),
  };
}
