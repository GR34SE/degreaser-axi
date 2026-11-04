import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { help: { type: "boolean" }, run: { type: "boolean" } },
});
if (values.help) {
  console.log(
    "pnpm test:live --run\nOpt-in subscription-backed scenarios. Check quota before running. No scenarios implemented yet.",
  );
} else {
  console.error(
    values.run
      ? "Live scenarios are not implemented yet. Nothing ran; no live assertions passed."
      : "Live tests are opt-in: pnpm test:live --run. Nothing ran; no live assertions passed.",
  );
  process.exitCode = 2;
}
