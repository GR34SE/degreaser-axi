import assert from "node:assert/strict";
import { items, object } from "../caller-evidence.ts";
import { callerProcess } from "../caller-process.ts";

import type { NativeCallerContext } from "./types.ts";

export async function codexCaller(context: NativeCallerContext) {
  const { model, cwd, prompt, observe, launcher, nativeVersion } = context;
  let session: string | undefined;
  // Reuse packaged native resolution/MCP suppression, not the ACP worker API.
  // Override caller permissions and hooks only for this disposable native session.
  const host = callerProcess(
    process.execPath,
    [
      launcher,
      "-c",
      `projects={ ${JSON.stringify(cwd)} = { trust_level = "trusted" } }`,
      "-c",
      "features.hooks=true",
      "app-server",
      "--listen",
      "stdio://",
    ],
    cwd,
    observe,
  );
  try {
    const request = async (id: number, method: string, params: object) => {
      const e = await host.request({ id, method, params }, (e) => e.id === id);
      assert.ok(!e.error, `Native ${method} failed`);
      return object(e.result);
    };
    await request(1, "initialize", {
      clientInfo: { name: "degreaser_caller_acceptance", version: "1" },
      capabilities: { experimentalApi: true },
    });
    host.send({ method: "initialized" });
    const found = await request(2, "hooks/list", { cwds: [cwd] });
    const hooks = items(found.data).flatMap((d) => items(d.hooks));
    const owned = hooks.find(
      (h) =>
        h.sourcePath === `${cwd}/.codex/hooks.json` &&
        String(h.command).includes("degreaser-startup-v1"),
    );
    assert.ok(
      owned?.currentHash && owned.key,
      "Installed project hook must be discovered",
    );
    const states = Object.fromEntries(
      hooks.map((h) => [
        String(h.key),
        h === owned
          ? { enabled: true, trusted_hash: h.currentHash }
          : { enabled: false },
      ]),
    );
    const skills = await request(3, "skills/list", {
      cwds: [cwd],
      forceReload: true,
    });
    assert.ok(
      items(skills.data)
        .flatMap((d) => items(d.skills))
        .some(
          (s) =>
            s.name === "degreaser" &&
            s.path === `${cwd}/.agents/skills/degreaser/SKILL.md` &&
            s.enabled,
        ),
    );
    const thread = await request(4, "thread/start", {
      cwd,
      model,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: true,
      experimentalRawEvents: true,
      config: { "hooks.state": states },
    });
    assert.equal(thread.model, model);
    session = String(object(thread.thread).id);
    const done = host.wait((e) => e.method === "turn/completed");
    await request(5, "turn/start", {
      threadId: session,
      input: [{ type: "text", text: prompt, text_elements: [] }],
    });
    const completed = await done;
    assert.equal(object(object(completed.params).turn).status, "completed");
    return {
      session,
      nativeVersion,
      skillDiscovered: true,
      hookTrust: "invocation-local exact declaration hash",
    };
  } finally {
    await host.close();
  }
}
