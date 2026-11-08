#!/usr/bin/env node
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "./version.js";

const args = process.argv.slice(2);
// Session hooks need a fast, never-failing path that skips the full CLI.
if (args[0] === "startup-context" && !process.env.DEGREASER_WORKER) {
  try {
    const { createFactory } = await import("./cli/factory.ts");
    const { startupContextMain } = await import(
      "./cli/commands/startup-context/process.js"
    );
    await startupContextMain(createFactory(), args);
  } catch {
    // Broken local installations must not break native session startup.
  }
} else if (
  args[0] !== "startup-context" &&
  !tryFastPath(args, { version: VERSION })
) {
  const { main } = await import("./cli/router.js");
  await main(args);
}
