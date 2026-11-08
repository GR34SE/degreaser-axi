import { type Agent, HARNESSES } from "../api.ts";
import { acceptedVersions, assertSupportedVersion } from "./versions.ts";

export { SUPPORTED_NATIVE_VERSIONS } from "../api.ts";
export const acceptedNativeVersions = (agent: Agent) =>
  acceptedVersions(HARNESSES[agent]);
export const assertNativeVersion = (agent: Agent, observed: string) =>
  assertSupportedVersion(HARNESSES[agent], observed);
