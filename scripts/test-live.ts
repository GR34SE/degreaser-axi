import { parseArgs } from "node:util";
import type { Agent } from "../src/config.ts";

const { values } = parseArgs({
  options: {
    help: { type: "boolean" },
    run: { type: "boolean" },
    case: { type: "string" },
    agent: { type: "string" },
    model: { type: "string" },
  },
});
if (values.help) {
  console.log(
    "pnpm test:live --run --case <native-worker|review|init|models|caller|caller-permissions|fleet> --agent <codex|claude|pi|cursor> --model <exact-id>\nOpt-in subscription-backed synthetic-file and public review pilots. Init exercises decisions before the same real review; models reads native metadata without inference. Caller tests project startup, skill discovery and personally waiting through terminal before continuation. Caller-permissions tests authorized/restricted Codex callers only. Fleet runs all default aspects uncapped for Codex or Claude, checks fresh quota and monitors actual host pressure with owned cancellation. Cursor supports native-worker, models, review and init. Build and check quota first. Other scenarios are not implemented.",
  );
} else if (
  values.run &&
  (values.case === "native-worker" ||
    values.case === "review" ||
    values.case === "init" ||
    values.case === "models" ||
    values.case === "caller-permissions" ||
    values.case === "caller" ||
    values.case === "fleet") &&
  values.agent &&
  values.model
) {
  if (!["codex", "claude", "pi", "cursor"].includes(values.agent))
    throw new Error("Unsupported live harness.");
  if (
    values.agent === "cursor" &&
    (values.case === "caller" ||
      values.case === "caller-permissions" ||
      values.case === "fleet")
  )
    throw new Error("Cursor live caller/fleet pilots are not implemented.");
  if (values.case === "fleet") {
    if (values.agent !== "codex" && values.agent !== "claude")
      throw new Error("Fleet pilot supports Codex and Claude only.");
    const { liveFleet } = await import("./live-fleet.ts");
    await liveFleet(values.agent, values.model);
  } else if (values.case === "caller") {
    const { liveCaller } = await import("./live-caller.ts");
    await liveCaller(values.agent as Exclude<Agent, "cursor">, values.model);
  } else if (values.case === "caller-permissions") {
    if (values.agent !== "codex")
      throw new Error("Caller permission pilot supports Codex only.");
    const { liveCallerPermissions } = await import(
      "./live-caller-permissions.ts"
    );
    await liveCallerPermissions(values.model);
  } else if (values.case === "native-worker") {
    const { liveNativeWorker } = await import("./live-native.ts");
    await liveNativeWorker(values.agent as Agent, values.model);
  } else if (values.case === "models") {
    const { liveModels } = await import("./live-models.ts");
    await liveModels(values.agent as Agent, values.model);
  } else {
    const { liveReview } = await import("./live-review.ts");
    await liveReview(
      values.agent as Agent,
      values.model,
      values.case === "init",
    );
  }
} else {
  console.error(
    values.run
      ? "Live scenarios are not implemented yet. Nothing ran; no live assertions passed."
      : "Live tests are opt-in: pnpm test:live --run. Nothing ran; no live assertions passed.",
  );
  process.exitCode = 2;
}
