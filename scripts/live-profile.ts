import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { NativeProfile } from "../src/native-profile.ts";

// Claude's documented family aliases track releases; explicit IDs remain exact.
// https://code.claude.com/docs/en/model-config#model-aliases
export function assertClaudeModel(requested: string, observed: unknown) {
  assert.ok(
    observed === requested ||
      (["haiku", "sonnet", "opus"].includes(requested) &&
        typeof observed === "string" &&
        observed.startsWith(`claude-${requested}-`)),
    "Native Claude model differs from the selected ID or family alias.",
  );
}

/** Native diagnostics under the same packaged launcher/environment, not adapter replacements. */
export function inspectNativeProfile(
  profile: NativeProfile,
  cwd: string,
  nonce: string,
  marker: string,
) {
  const wrapper = fileURLToPath(
    new URL(`../dist/bin/${profile.agent}-worker.js`, import.meta.url),
  );
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, [wrapper, ...args], {
      cwd,
      env: profile.environment,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(
      result.status,
      0,
      `Native ${profile.agent} diagnostic failed (no raw native output retained).`,
    );
    return result.stdout;
  };
  if (profile.agent === "codex") {
    const context = run([
      "debug",
      "prompt-input",
      "Synthetic source-only low-value-comments profile inspection",
    ]);
    const servers = JSON.parse(run(["mcp", "list", "--json"]));
    const features = run(["features", "list"]);
    assert.ok(!context.includes(marker));
    assert.match(context, /read.only/i);
    assert.match(context, /never/i);
    assert.ok(servers.every((s: { enabled: boolean }) => !s.enabled));
    for (const name of ["hooks", "multi_agent", "apps"])
      assert.match(features, new RegExp(`^${name}\\s+.*false$`, "m"));
    assert.match(features, /^code_mode_host\s+.*true$/m);
    return {
      contextCanaryAbsent: true,
      nativeReadOnlyContext: true,
      approvalNever: true,
      codeModeHost: true,
      enabledMcpServers: 0,
      disabledFeatures: ["hooks", "multi_agent", "apps"],
      residual:
        "User skills/managed policy may remain visible; no universal no-exec or path confinement.",
    };
  }
  if (profile.agent === "cursor") {
    const native = profile.environment.DEGREASER_NATIVE_EXECUTABLE;
    assert.ok(native);
    const version = spawnSync(native, ["--version"], {
      cwd,
      env: profile.environment,
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(version.status, 0, "Cursor native version probe failed.");
    assert.match(version.stdout, /20\d{2}\.\d{1,2}\.\d{1,2}-[0-9a-f]+/i);
    return {
      askModeArgv: true,
      nativeAcp: true,
      residual:
        "Ask mode and ACP deny-writes are not an OS sandbox; project MCP/hooks may remain visible.",
    };
  }
  const prompt =
    "Assigned aspect low-value-comments, native isolation diagnostic only. Read sample.ts and return its exact nonce. If a write/edit/exec tool is available, try once to write MUTATED to write-canary, and stop on denial. Do not invent a tool, seek workarounds, run tests, install, use internet or delegate. Do not load instructions or settings. State when write tools are unavailable.";
  const text = run(
    profile.agent === "claude"
      ? [
          "--print",
          "--verbose",
          "--output-format",
          "stream-json",
          "--max-turns",
          "4",
          prompt,
        ]
      : ["--mode", "json", "--no-session", "--print", prompt],
  );
  const events = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    text.includes(nonce),
    "Native diagnostic must actually read the nonce.",
  );
  assert.ok(!text.includes(marker));
  if (profile.agent === "claude") {
    const init = events.find(
      (e) => e.type === "system" && e.subtype === "init",
    );
    assert.ok(init);
    assert.deepEqual([...init.tools].sort(), ["Glob", "Grep", "Read"]);
    assert.equal(init.skills.length, 0);
    assert.equal(init.mcp_servers.length, 0);
    assertClaudeModel(profile.model, init.model);
    return {
      nativeSessionId: init.session_id,
      tools: init.tools,
      skills: 0,
      mcpServers: 0,
      model: init.model,
      requestedModel: profile.model,
      readNonceVerified: true,
    };
  }
  // Native system messages carry actual tool definitions. Keep names only.
  const system = events
    .flatMap((e) =>
      e.type === "message_start" || e.type === "message_end"
        ? [e.message]
        : e.type === "agent_end"
          ? e.messages
          : [],
    )
    .filter((m) => m?.role === "system");
  const names = [
    ...new Set(
      system.flatMap((m) =>
        (m.toolsAdded ?? []).map((t: { name: string }) => t.name),
      ),
    ),
  ].sort();
  assert.deepEqual(names, ["find", "grep", "ls", "read"]);
  return {
    tools: names,
    readNonceVerified: true,
    ambientMarkerAbsent: true,
    osSandbox: false,
  };
}
