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
      const synthetic = ["Synthetic external adapter; not a live provider result."];
export const PROFILE_LIMITATIONS = {codex: synthetic, claude: synthetic, pi: synthetic};
      export async function nativeProfile(identity, purpose = "review", signal) {
        const {readFileSync} = await import("node:fs");
        const {setTimeout} = await import("node:timers/promises");
        const plan = JSON.parse(readFileSync(process.env.SYNTHETIC_PLAN, "utf8"));
        if (purpose === "review" && plan.profileDelayMs)
          await setTimeout(plan.profileDelayMs, undefined, {signal});
        const actual = plan.productionProfile
          ? await (await import(${JSON.stringify(`${profile}?actual`)})).nativeProfile(identity, purpose, signal)
          : null;
        return {...identity, command: [process.execPath, ${JSON.stringify(adapter)}, process.env.SYNTHETIC_PLAN],
          environment: {...(actual?.environment ?? {PATH: process.env.PATH, HOME: process.env.HOME, DEGREASER_WORKER: "1"}), SYNTHETIC_AGENT: identity.agent, SYNTHETIC_MODEL: identity.model, SYNTHETIC_ASPECT: identity.aspect ?? "", SYNTHETIC_PURPOSE: purpose},
          adapterVersion: "synthetic", nativeVersion: "synthetic", limitations: [...PROFILE_LIMITATIONS[identity.agent]]};
      }`,
    };
  },
});
