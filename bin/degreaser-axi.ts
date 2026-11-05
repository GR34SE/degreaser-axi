#!/usr/bin/env node
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "../src/version.js";

const args = process.argv.slice(2);
if (!tryFastPath(args, { version: VERSION })) {
  const { main } = await import("../src/cli.js");
  await main(args);
}
