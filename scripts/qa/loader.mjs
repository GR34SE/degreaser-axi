import { pathToFileURL } from "node:url";

// Test-only external adapter boundary, never shipped or enabled by the product.
export async function load(url, context, nextLoad) {
  if (url !== pathToFileURL(process.env.QA_PROFILE).href)
    return nextLoad(url, context);
  return {
    format: "module",
    shortCircuit: true,
    source: `
const synthetic = ["Synthetic external adapter; not a live provider result."];
export const PROFILE_LIMITATIONS = {codex: synthetic, claude: synthetic, pi: synthetic};
export async function nativeProfile(identity, purpose = "review") {
  return {
    ...identity,
    command: [process.execPath, process.env.QA_ADAPTER, process.env.SYNTHETIC_PLAN],
    environment: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      DEGREASER_WORKER: "1", SYNTHETIC_AGENT: identity.agent,
      SYNTHETIC_MODEL: identity.model, SYNTHETIC_ASPECT: identity.aspect ?? "",
      SYNTHETIC_PURPOSE: purpose
    },
    adapterVersion: "synthetic", nativeVersion: "synthetic",
    limitations: [...PROFILE_LIMITATIONS[identity.agent]]
  };
}`,
  };
}
