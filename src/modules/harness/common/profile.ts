import type { Runtime } from "../../../util/exec/types.ts";
import { type Agent, HARNESSES } from "../api.ts";
import type { Identity, NativeProfile as Profile } from "../types.ts";

export type NativeProfile = Profile<Agent>;
export { PROFILE_LIMITATIONS } from "../api.ts";

export function nativeProfile(
  runtime: Runtime,
  identity: Identity<Agent>,
  purpose: "review" | "model-discovery" = "review",
  signal?: AbortSignal,
  spawned?: () => void,
): Promise<NativeProfile> {
  return HARNESSES[identity.agent].profile(
    runtime,
    identity,
    purpose,
    signal,
    spawned,
  );
}
