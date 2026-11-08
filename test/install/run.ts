import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { checkClaude } from "./claude.ts";
import { checkCodex } from "./codex.ts";
import { checkCursor } from "./cursor.ts";
import { installationFixture } from "./fixture.ts";
import { checkPi } from "./pi.ts";

const { values } = parseArgs({
  options: { harnesses: { type: "string" }, help: { type: "boolean" } },
});
if (values.help) {
  console.log(
    "pnpm test:install --harnesses codex,claude,pi,cursor\nOpt-in native installation checks in disposable homes; no model inference. Select only installed harnesses. Claude and Pi accept the product's verified version or a newer same-major build and record the unverified notice. Cursor's file install is checked in the disposable home. Its project sessionStart hook is executed by the logged-in CLI on a pseudoterminal with --trust for that disposable repo only; only that repo's workspace record is removed. User hooks and settings must remain unchanged, apart from native cache refresh timestamps; the check never restores whole user configuration files. ACP session creation does not run sessionStart and is not treated as hook delivery.",
  );
  process.exit(0);
}
const harnesses = values.harnesses?.split(",") ?? [];
assert.ok(
  harnesses.length &&
    new Set(harnesses).size === harnesses.length &&
    harnesses.every((h) => ["codex", "claude", "pi", "cursor"].includes(h)),
  "Select --harnesses codex,claude,pi,cursor (one or more).",
);

const context = installationFixture(harnesses);
const { root, cwd, cli, evidence, sync } = context;
let failed = false;
async function check(name: string, run: () => Promise<void>) {
  if (!harnesses.includes(name)) return;
  try {
    await run();
  } catch (error) {
    failed = true;
    evidence[name] = {
      ...(typeof evidence[name] === "object" ? evidence[name] : {}),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

try {
  sync("git", ["init", "-q"]);
  writeFileSync(
    join(cwd, ".degreaserrc.json"),
    `${JSON.stringify({ agent: "codex", model: "gpt-6-luna" })}\n`,
  );
  const userHarnesses = harnesses.filter((harness) => harness !== "cursor");
  if (userHarnesses.length)
    sync(process.execPath, [
      cli,
      "setup",
      "hooks",
      "--harnesses",
      userHarnesses.join(","),
      "--installation-scope",
      "user",
    ]);
  await check("codex", () => checkCodex(context));
  await check("claude", () => checkClaude(context));
  await check("pi", () => checkPi(context));
  await check("cursor", () => checkCursor(context));
} finally {
  console.log(JSON.stringify(evidence, null, 2));
  rmSync(root, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
