import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { alive, until } from "../utils/queue-fixture.ts";
import { runtime } from "../utils/runtime.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

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
      [
        join(root, "dist/modules/harness/codex/launcher.js"),
        "mcp",
        "list",
        "--json",
      ],
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

test("native effective configuration disables web under the production Codex profile", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-web-config-"));
  try {
    const home = join(cwd, ".codex");
    await mkdir(home);
    const config = 'web_search = "live"\n';
    await writeFile(join(home, "config.toml"), config);
    const {
      nativeProfile,
    }: typeof import("../../src/modules/harness/common/profile.ts") =
      await import(
        new URL("../../dist/modules/harness/common/profile.js", import.meta.url)
          .href
      );
    const profile = await nativeProfile(runtime(), {
      agent: "codex",
      model: "gpt-6-luna",
    });
    const child = spawn(
      process.execPath,
      [
        join(root, "dist/modules/harness/codex/launcher.js"),
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

test("aborting native profile startup joins the owned version process and its descendant", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-version-abort-"));
  const path = process.env.PATH;
  const pids: number[] = [];
  try {
    const log = join(cwd, "pids.json");
    await writeFile(
      join(cwd, "claude"),
      `#!${process.execPath}
import {spawn} from "node:child_process";
import {writeFileSync} from "node:fs";
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio: "ignore"});
writeFileSync(${JSON.stringify(log)}, JSON.stringify([process.pid, child.pid]));
child.on("exit", () => process.exit());
setInterval(()=>{},1000);
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${cwd}:${path}`;
    const { nativeProfile } = await import(
      "../../src/modules/harness/common/profile.ts"
    );
    const controller = new AbortController();
    const pending = nativeProfile(
      runtime(),
      { agent: "claude", model: "claude-haiku-4-5-20251001" },
      "review",
      controller.signal,
    );
    const outcome = pending.then(
      () => false,
      () => true,
    );
    await until(() => existsSync(log), "Version probe spawned");
    pids.push(...JSON.parse(await readFile(log, "utf8")));
    controller.abort();
    assert.equal(await outcome, true);
    await until(
      () => pids.every((pid) => !alive(pid)),
      "Aborted version processes must be joined",
      1000,
    );
  } finally {
    process.env.PATH = path;
    for (const pid of [...pids].reverse()) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
    await until(() => pids.every((pid) => !alive(pid)), "Version test cleanup");
    await rm(cwd, { recursive: true, force: true });
  }
});
