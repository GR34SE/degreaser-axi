#!/usr/bin/env node
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "../src/version.js";

const args = process.argv.slice(2);
// Session hooks need a fast, never-failing path that skips the full CLI.
if (args[0] === "startup-context") await import("./startup-context.js");
else if (!tryFastPath(args, { version: VERSION })) {
  const { main } = await import("../src/cli.js");
  await main(args);
}
