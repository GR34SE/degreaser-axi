import { parseArgs } from "node:util";

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
    "pnpm test:live --run --case <native-worker|review> --agent <codex|claude|pi> --model <exact-id>\nOpt-in subscription-backed synthetic-file and public review pilots. Build and check quota first. Other scenarios are not implemented.",
  );
} else if (
  values.run &&
  (values.case === "native-worker" || values.case === "review") &&
  values.agent &&
  values.model
) {
  if (!["codex", "claude", "pi"].includes(values.agent))
    throw new Error("Unsupported live harness.");
  if (values.case === "native-worker") {
    const { liveNativeWorker } = await import("./live-native.ts");
    await liveNativeWorker(
      values.agent as "codex" | "claude" | "pi",
      values.model,
    );
  } else {
    const { liveReview } = await import("./live-review.ts");
    await liveReview(values.agent as "codex" | "claude" | "pi", values.model);
  }
} else {
  console.error(
    values.run
      ? "Live scenarios are not implemented yet. Nothing ran; no live assertions passed."
      : "Live tests are opt-in: pnpm test:live --run. Nothing ran; no live assertions passed.",
  );
  process.exitCode = 2;
}
