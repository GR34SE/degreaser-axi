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
    "pnpm test:live --run --case native-worker --agent <codex|claude|pi> --model <exact-id>\nOpt-in subscription-backed synthetic-file read and isolation pilot. Build and check quota first. Other scenarios are not implemented.",
  );
} else if (
  values.run &&
  values.case === "native-worker" &&
  values.agent &&
  values.model
) {
  if (!["codex", "claude", "pi"].includes(values.agent))
    throw new Error("Unsupported live harness.");
  const { liveNativeWorker } = await import("./live-native.ts");
  await liveNativeWorker(
    values.agent as "codex" | "claude" | "pi",
    values.model,
  );
} else {
  console.error(
    values.run
      ? "Live scenarios are not implemented yet. Nothing ran; no live assertions passed."
      : "Live tests are opt-in: pnpm test:live --run. Nothing ran; no live assertions passed.",
  );
  process.exitCode = 2;
}
