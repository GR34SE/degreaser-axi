import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture } from "./git-fixture.ts";

test("installed hooks and Pi extension are bounded, local, worker-disabled and repair relocated package paths", async (t) => {
  const f = fixture(t);
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "degreaser-installed-startup-")),
  );
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const copy = join(home, "package's copy");
  mkdirSync(copy);
  cpSync(new URL("../dist", import.meta.url), join(copy, "dist"), {
    recursive: true,
  });
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(copy, "node_modules"),
  );
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
  };
  const setup = (cli: string) => {
    const result = spawnSync(
      process.execPath,
      [cli, "setup", "hooks", "--harnesses", "codex,claude,pi"],
      { cwd: f.root, env, encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  setup(join(copy, "dist/bin/degreaser-axi.js"));
  const shell = (command: string, extra: NodeJS.ProcessEnv = {}) =>
    spawnSync("/bin/sh", ["-c", command], {
      cwd: home,
      env: { ...env, ...extra },
      input: JSON.stringify({ cwd: f.root }),
      encoding: "utf8",
      timeout: 5000,
    });
  const commands = [".codex/hooks.json", ".claude/settings.json"].map(
    (path) => {
      const settings = JSON.parse(readFileSync(join(f.root, path), "utf8"));
      assert.deepEqual(Object.keys(settings.hooks), ["SessionStart"]);
      const hook = settings.hooks.SessionStart[0].hooks[0];
      assert.equal(hook.timeout, 2);
      return hook.command as string;
    },
  );
  const index = readFileSync(join(f.root, ".git/index"));
  for (const command of commands) {
    const result = shell(command);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.length < 1500);
    assert.match(
      JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
      /No local run yet/,
    );
    const worker = shell(command, { DEGREASER_WORKER: "1" });
    assert.equal(worker.status, 0);
    assert.equal(worker.stdout + worker.stderr, "");
  }
  const extension = await import(
    pathToFileURL(join(f.root, ".pi/extensions/degreaser.ts")).href
  );
  const messages: {
    type: string;
    customType: string;
    content: string;
    display: boolean;
  }[] = [];
  let startup: (() => Promise<void>) | undefined;
  const ctx = { cwd: f.root, sessionManager: { getBranch: () => messages } };
  extension.default({
    on(event: string, handler: (event: object, ctx: object) => Promise<void>) {
      assert.equal(event, "session_start");
      startup = () => handler({}, ctx);
    },
    sendMessage(
      message: { customType: string; content: string; display: boolean },
      options: object,
    ) {
      assert.deepEqual(options, { triggerTurn: false });
      messages.push({ type: "custom_message", ...message });
    },
  });
  assert.ok(startup);
  await startup();
  await startup();
  assert.equal(
    messages.length,
    1,
    "same-session reload must not duplicate identical context",
  );
  assert.equal(messages[0]?.display, false);
  assert.match(messages[0]?.content ?? "", /No local run yet/);
  f.write(".degreaser/state.json", "{");
  for (const command of commands) {
    const brokenState = shell(command);
    assert.equal(brokenState.status, 0);
    assert.equal(brokenState.stdout + brokenState.stderr, "");
  }
  await startup();
  assert.equal(messages.length, 1);
  rmSync(join(f.root, ".degreaser/state.json"));
  rmSync(join(copy, "dist/bin/startup-context.js"));
  for (const command of commands) {
    const missing = shell(command);
    assert.equal(missing.status, 0);
    assert.equal(missing.stdout + missing.stderr, "");
  }
  await startup();
  assert.equal(messages.length, 1);
  assert.ok(!existsSync(join(f.root, ".degreaser/state.json")));
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  setup(
    fileURLToPath(new URL("../dist/bin/degreaser-axi.js", import.meta.url)),
  );
  const repaired = JSON.parse(
    readFileSync(join(f.root, ".codex/hooks.json"), "utf8"),
  );
  assert.equal(repaired.hooks.SessionStart.length, 1);
  const healthy = shell(repaired.hooks.SessionStart[0].hooks[0].command);
  assert.equal(healthy.status, 0);
  assert.match(
    JSON.parse(healthy.stdout).hookSpecificOutput.additionalContext,
    /No local run yet/,
  );
});
