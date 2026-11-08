import { spawnSync } from "node:child_process";

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import type { TestContext } from "node:test";

import { fileURLToPath } from "node:url";

import { fixture } from "./git-fixture.ts";

export const cli = fileURLToPath(
  new URL("../../dist/main.js", import.meta.url),
);

export const loader = fileURLToPath(
  new URL("./synthetic-runtime.mjs", import.meta.url),
);

export const targets = ["codex", "claude", "pi", "cursor"];

export const faults = fileURLToPath(
  new URL("../fixtures/integration-fault.mjs", import.meta.url),
);

export function setup(t: TestContext) {
  const f = fixture(t);
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "degreaser-integration-home-")),
  );
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const plan = join(home, "plan.json");
  writeFileSync(plan, JSON.stringify({ log: join(home, "events.jsonl") }));
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
    SYNTHETIC_PLAN: plan,
  };
  const run = (args: string[], cwd = f.root) =>
    spawnSync(process.execPath, ["--import", loader, cli, ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
  const init = (harnesses: string, scope = "project") =>
    run([
      "init",
      "--agent",
      "codex",
      "--model",
      "gpt-6-luna",
      "--harnesses",
      harnesses,
      "--installation-scope",
      scope,
    ]);
  const maintenance = (harnesses: string, scope = "project", remove = false) =>
    run([
      "setup",
      "hooks",
      "--harnesses",
      harnesses,
      "--installation-scope",
      scope,
      ...(remove ? ["--remove"] : []),
    ]);
  return { ...f, home, env, run, init, maintenance };
}

export function installed(base: string, scope: string) {
  return {
    codex: existsSync(join(base, ".codex/hooks.json")),
    claude: existsSync(join(base, ".claude/settings.json")),
    pi: existsSync(
      join(
        base,
        scope === "user"
          ? ".pi/agent/extensions/degreaser.ts"
          : ".pi/extensions/degreaser.ts",
      ),
    ),
    cursor: existsSync(join(base, ".cursor/hooks.json")),
    shared: existsSync(join(base, ".agents/skills/degreaser/SKILL.md")),
    claudeSkill: existsSync(join(base, ".claude/skills/degreaser/SKILL.md")),
  };
}

export function snapshot(root: string) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const p = join(e.parentPath, e.name);
        return [p.slice(root.length), readFileSync(p).toString("base64")];
      }),
  );
}
