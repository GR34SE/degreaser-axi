#!/usr/bin/env node
import { ownRun } from "../src/owner.ts";

const [repository, id] = process.argv.slice(2);
if (!repository || !id) process.exitCode = 2;
else {
  try {
    await ownRun(repository, id);
  } catch {
    process.exitCode = 1;
  }
}
