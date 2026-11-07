import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Agent } from "../src/config.ts";
import { type CallerEvidence, items, object } from "./caller-evidence.ts";
import { callerEnvironment, callerProcess } from "./caller-process.ts";
import { assertClaudeModel } from "./live-profile.ts";

export async function nativeCaller(
  agent: Exclude<Agent, "cursor">,
  model: string,
  cwd: string,
  prompt: string,
  trace: CallerEvidence,
  checkFiles: () => void,
  phase: "context" | "review",
) {
  const launcher = fileURLToPath(
    new URL("../dist/bin/codex-worker.js", import.meta.url),
  );
  const version = spawnSync(
    agent === "codex" ? process.execPath : agent,
    agent === "codex" ? [launcher, "--version"] : ["--version"],
    { cwd, env: callerEnvironment, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(version.status, 0, "Native version probe failed");
  const nativeVersion = version.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  assert.equal(
    nativeVersion,
    { codex: "0.165.0", claude: "2.1.317", pi: "1.4.0" }[agent],
    "Revalidate changed native caller version before inference",
  );
  let session: string | undefined;
  let starts = 0;
  const observe = (e: Record<string, unknown>) => {
    trace.record(e);
    checkFiles();
    if (e.type === "agent_start") starts++;
  };
  if (agent === "pi") {
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
      observe,
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
  if (agent === "claude") {
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
