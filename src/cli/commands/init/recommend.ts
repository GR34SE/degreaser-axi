import type { Identity } from "../../../config/types.ts";
import { HARNESSES } from "../../../modules/harness/api.ts";

export function recommend(candidates: Identity[]) {
  return (
    [0, 1, 2]
      .map((rank) => candidates.find((c) => recommendationRank(c) === rank))
      .find(Boolean) ?? null
  );
}

function recommendationRank({ agent, model }: Identity) {
  return HARNESSES[agent].recommendationRank(model);
}

export function sameIdentity(left: Identity, right: Identity) {
  return left.agent === right.agent && left.model === right.model;
}
