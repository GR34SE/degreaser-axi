#!/usr/bin/env node
import { once } from "node:events";
import { InputError } from "../src/input-error.ts";
import { ownRun, type ResumeControls } from "../src/owner.ts";
import { StateError } from "../src/storage.ts";

const [repository, id] = process.argv.slice(2);
if (!repository || !id) process.exitCode = 2;
else {
  try {
    if (!process.connected)
      throw new StateError(
        "owner-failed",
        "Owner admission requires its caller's request.",
      );
    const request: { controls?: ResumeControls } = (
      await Promise.race([
        once(process, "message"),
        once(process, "disconnect").then(() => {
          throw new StateError(
            "owner-failed",
            "Caller disconnected before owner admission.",
          );
        }),
      ])
    )[0];
    await ownRun(repository, id, request.controls, () => {
      if (process.connected) process.send?.({}, () => {});
    });
  } catch (error) {
    const diagnostic =
      error instanceof StateError || error instanceof InputError;
    if (process.connected)
      process.send?.(
        {
          code: diagnostic ? error.code : "owner-failed",
          message: diagnostic ? error.message : "Owner could not start safely.",
        },
        () => {},
      );
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}
