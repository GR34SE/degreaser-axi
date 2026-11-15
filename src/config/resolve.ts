import type { AspectId } from "../modules/aspect/api.ts";
import { InputError } from "../util/errors.ts";
import { schema } from "../util/schema.ts";
import { completeConfig } from "./defaults.ts";
import type {
  EffectiveConfig,
  Identity,
  ProjectConfig,
  ReviewControls,
} from "./types.ts";

export function resolveConfig(
  data: unknown,
  controls: ReviewControls,
  aspectIds: readonly AspectId[],
): EffectiveConfig {
  const rc = completeConfig(data, aspectIds);
  const enabled = aspectIds.filter((id) => rc.aspects[id] !== false);
  const override = (id: AspectId) => {
    const setting = rc.aspects[id];
    return typeof setting === "object" ? setting : undefined;
  };
  if (enabled.length === 0 || controls.aspects?.length === 0)
    throw new InputError("The effective aspect selection is empty.");
  if (controls.aspects) {
    if (new Set(controls.aspects).size !== controls.aspects.length)
      throw new InputError("Duplicate aspect IDs are invalid.");
    for (const id of controls.aspects) {
      if (!aspectIds.some((known) => known === id))
        throw new InputError(
          `Unknown aspect ID: ${id}. Use one of: ${aspectIds.join(", ")}.`,
        );
      if (!enabled.some((known) => known === id))
        throw new InputError(
          `Explicit aspect ${id} is disabled by project configuration.`,
        );
    }
  }
  if (
    controls.concurrency !== undefined &&
    (!Number.isSafeInteger(controls.concurrency) || controls.concurrency <= 0)
  ) {
    throw new InputError("concurrency must be a positive safe integer.");
  }
  const verifier: Identity = {
    agent: rc.verifier.agent ?? rc.agent,
    model: rc.verifier.model,
  };
  const checkIdentity = schema<ProjectConfig>(
    new URL("./config.schema.json", import.meta.url),
  );
  for (const id of aspectIds) {
    if (
      !checkIdentity({
        agent: override(id)?.agent ?? rc.agent,
        model: override(id)?.model ?? rc.model,
      })
    ) {
      throw new InputError(`${id}: Pi requires a provider-qualified model ID.`);
    }
  }
  if (!checkIdentity(verifier))
    throw new InputError(
      "verifier: Pi requires a provider-qualified model ID.",
    );
  return {
    assignments: enabled
      .filter((id) => !controls.aspects || controls.aspects.includes(id))
      .map((aspect) => ({
        aspect,
        agent: override(aspect)?.agent ?? rc.agent,
        model: override(aspect)?.model ?? rc.model,
      })),
    verifier,
    concurrency: controls.concurrency ?? rc.concurrency,
    maxRetries: rc.maxRetries,
    limits: rc.limits,
    exclude: [...rc.exclude],
  };
}

export function unsupportedModel(
  { agent, model }: Identity,
  available: readonly string[],
) {
  return new InputError(
    `${agent}/${model} is neither an advertised ${agent} model ID nor a latest selector with an advertised family. No substitute was selected. Available ${agent} models: ${available.join(", ") || "none"}.`,
  );
}
