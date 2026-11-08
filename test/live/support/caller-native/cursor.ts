import assert from "node:assert/strict";
import { callerEnvironment, callerProcess } from "../caller-process.ts";

import type { NativeCallerContext } from "./types.ts";

export async function cursorCaller(context: NativeCallerContext) {
  const {
    model,
    cwd,
    prompt,
    trace,
    observe,
    phase,
    extraEnvironment,
    executable,
    nativeVersion,
  } = context;
  let session: string | undefined;

  let observedModel: unknown;
  // Print mode runs project sessionStart. ACP review sessions do not.
  const host = callerProcess(
    executable,
    [
      "--print",
      "--output-format",
      "stream-json",
      "--trust",
      "--force",
      "--sandbox",
      "disabled",
      "--model",
      model,
      "--workspace",
      cwd,
      prompt,
    ],
    cwd,
    (e) => {
      if (e.type === "system" && e.subtype === "init") {
        if (session)
          assert.equal(e.session_id, session, "Caller session changed");
        session = String(e.session_id ?? "");
        observedModel = e.model;
      }
      observe(e);
    },
    { ...callerEnvironment, ...extraEnvironment },
  );
  try {
    const result = await host.wait(
      (e) => e.type === "result",
      phase === "review" ? 720_000 : 180_000,
    );
    assert.notEqual(result.is_error, true, "Cursor caller failed");
    assert.notEqual(result.subtype, "error", "Cursor caller failed");
    if (
      typeof observedModel === "string" &&
      (observedModel.includes("[") || observedModel.includes("/"))
    )
      assert.ok(
        observedModel === model || observedModel.endsWith(`/${model}`),
        `Cursor caller model ${observedModel} is not ${model}`,
      );
    return {
      session,
      nativeVersion,
      observedModel,
      foreground: true,
      skillDiscovered: trace.events.some((event) => event.skillLoaded),
    };
  } finally {
    await host.close();
  }
}
