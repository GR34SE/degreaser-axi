// Explicit synthetic process boundary: compiled CLI, owner, Git, acpx and
// result/storage code remain real. This loader is never shipped or enabled by the product.
import { registerHooks } from "node:module";

const profile = new URL("../../dist/src/native-profile.js", import.meta.url)
  .href;
const adapter = new URL("./review-acp.mjs", import.meta.url).pathname;
registerHooks({
  load(url, context, nextLoad) {
    if (url !== profile) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: `
      export const PROFILE_LIMITATIONS = {codex: [], claude: [], pi: []};
      export async function nativeProfile(identity) {
        return {...identity, command: [process.execPath, ${JSON.stringify(adapter)}, process.env.SYNTHETIC_PLAN],
          environment: {PATH: process.env.PATH, HOME: process.env.HOME, DEGREASER_WORKER: "1", SYNTHETIC_AGENT: identity.agent, SYNTHETIC_MODEL: identity.model},
          adapterVersion: "synthetic", nativeVersion: "synthetic", limitations: ["Synthetic external adapter; not a live provider result."]};
      }`,
    };
  },
});
