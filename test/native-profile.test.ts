import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("bundled Codex disables configured MCP without modifying user configuration", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-codex-config-"));
  try {
    const home = join(cwd, ".codex");
    await mkdir(home);
    const config =
      '[mcp_servers."fixture.dot"]\ncommand = "/usr/bin/false"\n[features]\nhooks = true\nmulti_agent = true\napps = true\n';
    await writeFile(join(home, "config.toml"), config);
    const result = spawnSync(
      process.execPath,
      [join(root, "dist/bin/codex-worker.js"), "mcp", "list", "--json"],
      {
        cwd,
        env: { HOME: cwd, CODEX_HOME: home, PATH: process.env.PATH },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const servers = JSON.parse(result.stdout);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].name, "fixture.dot");
    assert.equal(servers[0].enabled, false);
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), config);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("packaged Claude launcher replaces conflicting profile flags and preserves stream controls", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-native-"));
  try {
    const consumer = join(cwd, "native");
    await writeFile(
      consumer,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({args:process.argv.slice(2),marker:process.env.DEGREASER_WORKER}));\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        join(root, "dist/bin/claude-worker.js"),
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--tools",
        "Bash",
        "Write",
        "--tools=Edit",
        "--settings",
        '{"hooks":{"SessionStart":[]}}',
        "--setting-sources=user,project",
        "--mcp-config",
        '{"mcpServers":{"bad":{}}}',
        "--allowedTools",
        "Bash",
        "--permission-mode",
        "bypassPermissions",
        "--fallback-model",
        "other",
        "--model",
        "other",
        "--resume",
        "control-id",
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          DEGREASER_NATIVE_EXECUTABLE: consumer,
          DEGREASER_MODEL: "exact-model",
          DEGREASER_WORKER: "1",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const { args, marker } = JSON.parse(result.stdout);
    const option = (name: string) => args[args.indexOf(name) + 1];
    assert.equal(marker, "1");
    assert.equal(option("--tools"), "Read,Grep,Glob");
    assert.equal(option("--setting-sources"), "");
    assert.deepEqual(JSON.parse(option("--settings")), {
      disableAllHooks: true,
      apiKeyHelper: "",
    });
    assert.deepEqual(JSON.parse(option("--mcp-config")), { mcpServers: {} });
    assert.equal(option("--permission-mode"), "default");
    assert.equal(option("--model"), "exact-model");
    assert.equal(option("--resume"), "control-id");
    assert.equal(option("--input-format"), "stream-json");
    assert.equal(option("--output-format"), "stream-json");
    assert.equal(args.filter((a: string) => a === "--tools").length, 1);
    assert.ok(
      args.includes("--safe-mode") &&
        args.includes("--disable-slash-commands") &&
        args.includes("--strict-mcp-config"),
    );
    assert.ok(!args.includes("--fallback-model") && !args.includes("Bash"));
    const discovery = spawnSync(
      process.execPath,
      [
        join(root, "dist/bin/claude-worker.js"),
        "--model",
        "unsupported-id",
        "--tools",
        "Bash",
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          DEGREASER_NATIVE_EXECUTABLE: consumer,
          DEGREASER_MODEL: "unsupported-id",
          DEGREASER_MODEL_DISCOVERY: "1",
        },
      },
    );
    assert.equal(discovery.status, 0, discovery.stderr);
    const discoveredArgs = JSON.parse(discovery.stdout).args;
    assert.ok(
      !discoveredArgs.includes("--model") &&
        !discoveredArgs.includes("unsupported-id"),
    );
    assert.equal(
      discoveredArgs[discoveredArgs.indexOf("--tools") + 1],
      "Read,Grep,Glob",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Pi launcher pins argv model, removes discovery and cannot inherit metered credentials", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-native-"));
  try {
    const consumer = join(cwd, "native");
    await writeFile(
      consumer,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    const invoke = (extra: Record<string, string> = {}) =>
      spawnSync(
        process.execPath,
        [join(root, "dist/bin/pi-worker.js"), "--mode", "rpc", "--no-themes"],
        {
          cwd,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            DEGREASER_NATIVE_EXECUTABLE: consumer,
            DEGREASER_MODEL: "openai/exact-model",
            ...extra,
          },
        },
      );
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.stdout);
    assert.equal(args[args.indexOf("--model") + 1], "openai/exact-model");
    assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
    for (const flag of [
      "--no-skills",
      "--no-extensions",
      "--no-mcp",
      "--no-context-files",
      "--no-prompt-templates",
      "--offline",
    ])
      assert.ok(args.includes(flag));
    const blocked = invoke({ OPENAI_API_KEY: "synthetic-secret" });
    assert.notEqual(blocked.status, 0);
    assert.ok(!blocked.stderr.includes("synthetic-secret"));
    assert.equal(blocked.stdout, "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("adapter environment is allowlisted even when acpx promotes inherited auth grants", async () => {
  const { workerEnvironment } = await import("../src/native-environment.ts");
  const env = workerEnvironment({
    HOME: "/fixture/home",
    PATH: "/usr/bin",
    CODEX_HOME: "/fixture/auth",
    OPENAI_API_KEY: "synthetic-secret",
    ACPX_AUTH_OPENAI_API_KEY: "synthetic-secret",
    NODE_OPTIONS: "--require malicious",
    HTTPS_PROXY: "https://bad.invalid",
    DEGREASER_WORKER: "0",
    CLAUDE_CODE_USE_BEDROCK: "1",
  });
  assert.deepEqual(env, {
    HOME: "/fixture/home",
    PATH: "/usr/bin",
    CODEX_HOME: "/fixture/auth",
    DEGREASER_WORKER: "1",
  });
});

test("compiled doctor refuses an unsupported native version before adapter launch without substitution", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-wrong-version-"));
  try {
    const bin = join(cwd, "bin");
    await mkdir(bin);
    const log = join(cwd, "native-calls.jsonl");
    const native = `#!${process.execPath}
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
console.log("99.0.0");
`;
    await writeFile(join(bin, "claude"), native, { mode: 0o755 });
    await writeFile(
      join(cwd, ".degreaserrc.json"),
      JSON.stringify({ agent: "claude", model: "claude-haiku-4-5-20251001" }),
    );
    assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
    const result = spawnSync(
      process.execPath,
      [join(root, "dist/bin/degreaser-axi.js"), "doctor"],
      {
        cwd,
        encoding: "utf8",
        timeout: 15000,
        env: { HOME: cwd, PATH: `${bin}:${process.env.PATH}` },
      },
    );
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /environment-blocked/);
    assert.match(result.stdout, /incompatible/);
    assert.equal(await readFile(log, "utf8"), '["--version"]\n');
    assert.equal(await readFile(join(bin, "claude"), "utf8"), native);
    await assert.rejects(readFile(join(cwd, ".degreaser/state.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("native effective configuration disables web under the production Codex profile", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-web-config-"));
  try {
    const home = join(cwd, ".codex");
    await mkdir(home);
    const config = 'web_search = "live"\n';
    await writeFile(join(home, "config.toml"), config);
    const { nativeProfile }: typeof import("../src/native-profile.ts") =
      await import(
        new URL("../dist/src/native-profile.js", import.meta.url).href
      );
    const profile = await nativeProfile({
      agent: "codex",
      model: "gpt-6-luna",
    });
    // Native stdio diagnostics only, no listening port, thread or turn.
    const child = spawn(
      process.execPath,
      [
        join(root, "dist/bin/codex-worker.js"),
        "app-server",
        "--listen",
        "stdio://",
      ],
      {
        cwd,
        detached: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...profile.environment, HOME: cwd, CODEX_HOME: home },
      },
    );
    const closed = once(child, "close");
    const stop = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    const timeout = setTimeout(() => stop("SIGKILL"), 15000);
    const lines = createInterface({ input: child.stdout });
    let effective:
      | { web_search: string; sandbox_mode: string; approval_policy: string }
      | undefined;
    const send = (message: object) =>
      child.stdin.write(`${JSON.stringify(message)}\n`);
    try {
      send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "degreaser_profile_check", version: "0.1.0" },
          capabilities: null,
        },
      });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.id === 1) {
          assert.ok(!message.error, "Native initialize failed.");
          send({ method: "initialized" });
          send({
            id: 2,
            method: "config/read",
            params: { cwd, includeLayers: false },
          });
        } else if (message.id === 2) {
          assert.ok(!message.error, "Native config/read failed.");
          effective = message.result.config;
          break;
        }
      }
    } finally {
      lines.close();
      stop("SIGTERM");
      await closed;
      stop("SIGKILL");
      clearTimeout(timeout);
    }
    assert.equal(effective?.web_search, "disabled");
    assert.equal(effective?.sandbox_mode, "read-only");
    assert.equal(effective?.approval_policy, "never");
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), config);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
