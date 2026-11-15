import type { Agent, Identity } from "../../../config/types.ts";
import { HARNESSES } from "../../../modules/harness/api.ts";
import type { ModelTier } from "../../../modules/harness/common/recommend.ts";

export const byPriority = (a: Agent, b: Agent) =>
  HARNESSES[a].recommendationPriority - HARNESSES[b].recommendationPriority;

function pick(candidates: Identity[], order: ModelTier[]) {
  const ranked = candidates.toSorted((a, b) => byPriority(a.agent, b.agent));
  return (
    order
      .map((tier) =>
        ranked.find((c) => HARNESSES[c.agent].modelTier(c.model) === tier),
      )
      .find(Boolean) ?? null
  );
}

export const recommend = (candidates: Identity[]) =>
  pick(candidates, ["balanced", "light"]);

export const recommendVerifier = (candidates: Identity[]) =>
  pick(candidates, ["strong", "balanced"]);

export function sameIdentity(left: Identity, right: Identity) {
  return left.agent === right.agent && left.model === right.model;
}
