import assert from "node:assert/strict";
import { items, object } from "../caller-evidence.ts";
import { callerProcess } from "../caller-process.ts";
import { assertClaudeModel } from "../live-profile.ts";

import type { NativeCallerContext } from "./types.ts";

export async function claudeCaller(context: NativeCallerContext) {
  const { model, cwd, prompt, trace, observe, phase, nativeVersion } = context;
  let session: string | undefined;

  let observedModel: unknown;
  let resultCount = 0;
  const notifications: { task: string; status: string }[] = [];
  const host = callerProcess(
    "claude",
    [
      "--print",
      "--verbose",
      "--model",
      model,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--tools",
      "Bash,Read,Write,Skill",
      "--allowedTools",
      "Bash,Read,Write,Skill",
      "--permission-mode",
      "dontAsk",
    ],
    cwd,
    (e) => {
      if (e.type === "system" && e.subtype === "init") {
        assertClaudeModel(model, e.model);
        observedModel = e.model;
        if (session)
          assert.equal(e.session_id, session, "Caller session changed");
        session = String(e.session_id);
      }
      if (e.type === "result") resultCount++;
      if (e.type === "system" && e.subtype === "task_notification")
        notifications.push({
          task: String(e.task_id),
          status: String(e.status),
        });
      observe(e);
    },
  );
  try {
    const init = await host.request(
      {
        type: "control_request",
        request_id: "init",
        request: { subtype: "initialize" },
      },
      (e) =>
        e.type === "control_response" &&
        object(e.response).request_id === "init",
    );
    assert.ok(
      items(object(object(init.response).response).commands).some(
        (c) => c.name === "degreaser",
      ),
    );
    // Print mode can emit an interim result while tracked Bash work is active.
    // Keep this native session attached for its automatic notification turn.
    const done = host.wait(
      (e) =>
        e.type === "result" &&
        (e.is_error === true ||
          phase === "context" ||
          trace.events.some(
            (event) =>
              event.kind === "result" && event.operation === "continue",
          )),
    );
    host.send({ type: "user", message: { role: "user", content: prompt } });
    const result = await done;
    assert.equal(result.is_error, false, "Claude caller failed");
    assert.ok(session);
    if (resultCount > 1)
      assert.ok(
        notifications.length > 0,
        "Missing native tracked completion notification",
      );
    return {
      session,
      nativeVersion,
      skillDiscovered: true,
      resultCount,
      notifications,
      requestedModel: model,
      observedModel,
    };
  } finally {
    await host.close();
  }
}
