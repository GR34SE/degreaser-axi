import type { Harness, HarnessDefinition } from "../types.ts";
import { buildProfile } from "./build-profile.ts";
import { discoverProfileModels } from "./discovery.ts";

export function defineHarness<const Id extends string>(
  definition: HarnessDefinition<Id>,
): Harness & { id: Id } {
  const harness: Harness & { id: Id } = {
    ...definition,
    profile: (runtime, identity, purpose, signal, spawned) =>
      buildProfile(definition, runtime, identity, purpose, signal, spawned),
    discoverModels: (runtime, model, cwd, timeoutMs, signal) =>
      discoverProfileModels(
        () =>
          harness.profile(
            runtime,
            { agent: definition.id, model },
            "model-discovery",
            signal,
          ),
        cwd,
        timeoutMs,
        signal,
      ),
  };
  return harness;
}
