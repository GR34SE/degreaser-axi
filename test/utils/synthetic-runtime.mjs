import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const profile = process.env.QA_PROFILE
  ? pathToFileURL(process.env.QA_PROFILE).href
  : new URL(
      "../../dist/modules/harness/common/build-profile.js",
      import.meta.url,
    ).href;
const adapter =
  process.env.QA_ADAPTER ??
  new URL("../fixtures/review-acp.mjs", import.meta.url).pathname;
const registry = new URL("../api.js", profile).href;
const limitation = "Synthetic external adapter; not a live provider result.";

export function load(url, context, nextLoad) {
  if (url === registry) {
    const result = nextLoad(url, context);
    const source =
      typeof result.source === "string"
        ? result.source
        : Buffer.from(result.source).toString("utf8");
    return {
      ...result,
      source:
        source +
        `
        for (const [id, harness] of Object.entries(HARNESSES)) {
          harness.limitations = [${JSON.stringify(limitation)}];
          PROFILE_LIMITATIONS[id] = [...harness.limitations];
        }`,
    };
  }
  if (url !== profile) return nextLoad(url, context);
  return {
    format: "module",
    shortCircuit: true,
    source: `
      export async function buildProfile(definition, runtime, identity, purpose = "review", signal, spawned) {
        const {readFileSync} = await import("node:fs");
        const {setTimeout} = await import("node:timers/promises");
        const plan = JSON.parse(readFileSync(runtime.env.SYNTHETIC_PLAN, "utf8"));
        if (purpose === "review" && plan.profileDelayMs)
          await setTimeout(plan.profileDelayMs, undefined, {signal});
        const actual = plan.productionProfile
          ? await (await import(${JSON.stringify(`${profile}?actual`)})).buildProfile(definition, runtime, identity, purpose, signal, spawned)
          : null;
        return {...identity,
          command: [runtime.executable, ${JSON.stringify(adapter)}, runtime.env.SYNTHETIC_PLAN],
          environment: {
            ...(actual?.environment ?? {PATH: runtime.env.PATH, HOME: runtime.env.HOME, DEGREASER_WORKER: "1"}),
            SYNTHETIC_AGENT: identity.agent, SYNTHETIC_MODEL: identity.model,
            SYNTHETIC_ASPECT: identity.aspect ?? "", SYNTHETIC_PURPOSE: purpose,
          },
          adapterVersion: "synthetic", nativeVersion: "synthetic",
          limitations: [${JSON.stringify(limitation)}],
        };
      }`,
  };
}
registerHooks({ load });
