import * as contractBypass from "./contract-bypass/index.ts";
import * as conventionDrift from "./convention-drift/index.ts";
import * as incompleteIntegration from "./incomplete-integration/index.ts";
import * as lowValueComments from "./low-value-comments/index.ts";
import * as lowValueTests from "./low-value-tests/index.ts";
import * as maskedErrors from "./masked-errors/index.ts";
import * as missedReuse from "./missed-reuse/index.ts";
import * as reinventedInfrastructure from "./reinvented-infrastructure/index.ts";
import * as scopeCreep from "./scope-creep/index.ts";
import * as speculativeFlexibility from "./speculative-flexibility/index.ts";
import * as structuralErosion from "./structural-erosion/index.ts";
import type { Aspect } from "./types.ts";
import * as unidiomaticCode from "./unidiomatic-code/index.ts";
import * as unjustifiedDefense from "./unjustified-defense/index.ts";
import * as unnecessaryComplexity from "./unnecessary-complexity/index.ts";
import * as unnecessaryLayers from "./unnecessary-layers/index.ts";
import * as verificationTheater from "./verification-theater/index.ts";
import * as wrongAbstraction from "./wrong-abstraction/index.ts";

/** Insertion order is review priority. */
export const ASPECTS = {
  "unnecessary-complexity": unnecessaryComplexity,
  "masked-errors": maskedErrors,
  "verification-theater": verificationTheater,
  "contract-bypass": contractBypass,
  "incomplete-integration": incompleteIntegration,
  "low-value-tests": lowValueTests,
  "scope-creep": scopeCreep,
  "reinvented-infrastructure": reinventedInfrastructure,
  "missed-reuse": missedReuse,
  "wrong-abstraction": wrongAbstraction,
  "structural-erosion": structuralErosion,
  "speculative-flexibility": speculativeFlexibility,
  "unnecessary-layers": unnecessaryLayers,
  "unjustified-defense": unjustifiedDefense,
  "convention-drift": conventionDrift,
  "unidiomatic-code": unidiomaticCode,
  "low-value-comments": lowValueComments,
} as const satisfies Record<string, Aspect>;

export type AspectId = keyof typeof ASPECTS;
export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];
