import assert from "node:assert/strict";
import { items, object } from "../caller-evidence.ts";
import { callerProcess } from "../caller-process.ts";

import type { NativeCallerContext } from "./types.ts";

export async function piCaller(context: NativeCallerContext) {
  const { model, cwd, prompt, observe, nativeVersion } = context;
  let session: string | undefined;
  let starts = 0;
  const observed = (event: Record<string, unknown>) => {
    observe(event);
    if (event.type === "agent_start") starts++;
  };

  const host = callerProcess(
    "pi",
    [
      "--mode",
      "rpc",
      "--model",
      model,
      "--approve",
      "--tools",
      "read,bash,write",
      "--no-mcp",
      "--no-context-files",
      "--no-prompt-templates",
      "--offline",
      "--no-session",
    ],
    cwd,
    observed,
  );
  try {
    const state = await host.request(
      { id: "state", type: "get_state" },
      (e) => e.id === "state",
    );
    const selected = object(object(state.data).model);
    assert.equal(`${selected.provider}/${selected.id}`, model);
    session = String(object(state.data).sessionId);
    const commands = await host.request(
      { id: "commands", type: "get_commands" },
      (e) => e.id === "commands",
    );
    assert.ok(
      items(object(commands.data).commands).some(
        (c) =>
          c.name === "skill:degreaser" &&
          object(c.sourceInfo).scope === "project",
      ),
    );
    const messages = await host.request(
      { id: "messages", type: "get_messages" },
      (e) => e.id === "messages",
    );
    assert.ok(
      items(object(messages.data).messages).some(
        (m) => m.customType === "degreaser-startup",
      ),
    );
    assert.equal(
      starts,
      0,
      "Pi startup must not start an independent model turn",
    );
    const done = host.wait((e) => e.type === "agent_end");
    host.send({ id: "prompt", type: "prompt", message: prompt });
    await done;
    assert.equal(starts, 1);
    return {
      session,
      nativeVersion,
      startupWithoutTurn: true,
      skillDiscovered: true,
    };
  } finally {
    await host.close();
  }
}
