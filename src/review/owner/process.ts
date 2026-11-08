#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { homedir } from "node:os";
import { InputError, StateError } from "../../util/errors.ts";
import type { ResumeControls } from "../types.ts";
import { ownRun } from "./index.ts";

let exitCode = 0;
const [repository, id] = process.argv.slice(2);
if (!repository || !id) exitCode = 2;
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
    await ownRun(
      {
        env: { ...process.env },
        executable: process.execPath,
        arguments: process.execArgv,
        home: homedir(),
        now: Date.now,
        spawn,
        spawnSync,
      },
      repository,
      id,
      request.controls,
      () => {
        if (process.connected) process.send?.({}, () => {});
      },
    );
  } catch (error) {
    const diagnostic =
      error instanceof StateError || error instanceof InputError;
    if (process.connected)
      await new Promise<void>((resolve) =>
        process.send?.(
          {
            code: diagnostic ? error.code : "owner-failed",
            message: diagnostic
              ? error.message
              : "Owner could not start safely.",
          },
          () => resolve(),
        ),
      );
    exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}

if (exitCode) process.exit(exitCode);
