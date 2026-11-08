import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";

import test from "node:test";

import { cli, installed, loader, setup } from "../utils/integration-fixture.ts";

test("Claude's skill can link to the shared .agents copy and switch back to a copy", (t) => {
  const f = setup(t);
  const dir = join(f.root, ".claude/skills/degreaser");
  const linkArgs = [
    "setup",
    "hooks",
    "--harnesses",
    "codex,claude",
    "--skill-install",
    "link",
  ];
  assert.equal(f.maintenance("codex,claude").status, 0);
  assert.ok(lstatSync(dir).isDirectory());
  const linked = f.run(linkArgs);
  assert.equal(linked.status, 0, linked.stdout);
  assert.equal(readlinkSync(dir), "../../.agents/skills/degreaser");
  assert.equal(
    readFileSync(join(dir, "SKILL.md"), "utf8"),
    readFileSync(join(f.root, ".agents/skills/degreaser/SKILL.md"), "utf8"),
  );
  assert.equal(f.run(linkArgs).status, 0);
  const copied = f.maintenance("codex,claude");
  assert.equal(copied.status, 0, copied.stdout);
  assert.ok(lstatSync(dir).isDirectory());
  assert.ok(lstatSync(join(dir, "SKILL.md")).isFile());
  assert.equal(f.run(linkArgs).status, 0);
  assert.equal(f.maintenance("claude", "project", true).status, 0);
  assert.equal(existsSync(dir), false);
  assert.ok(existsSync(join(f.root, ".agents/skills/degreaser/SKILL.md")));
  const alone = f.run([
    "setup",
    "hooks",
    "--harnesses",
    "claude",
    "--skill-install",
    "link",
  ]);
  assert.equal(alone.status, 2, alone.stdout);
});

test("receipt-less remove keeps edited skills and a shared skill another harness still uses", (t) => {
  const f = setup(t);
  assert.equal(f.maintenance("codex,cursor").status, 0);
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  assert.equal(f.maintenance("codex", "project", true).status, 0);
  assert.ok(installed(f.root, "project").shared);
  assert.ok(!installed(f.root, "project").codex);
  assert.equal(f.maintenance("cursor", "project", true).status, 0);
  assert.ok(!installed(f.root, "project").shared);
  assert.equal(f.maintenance("claude").status, 0);
  const settings = join(f.root, ".claude/settings.json");
  writeFileSync(
    settings,
    readFileSync(settings, "utf8").replace("degreaser-startup-v1", "edited"),
  );
  const edited = readFileSync(settings, "utf8");
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  const kept = f.maintenance("claude", "project", true);
  assert.equal(kept.status, 0, kept.stdout);
  assert.equal(readFileSync(settings, "utf8"), edited);
});

test("setup hooks errors point to the full subcommand help", (t) => {
  const f = setup(t);
  const result = f.run(["setup", "hooks", "--harnesses", "bogus"]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /degreaser-axi setup hooks --help/);
  assert.doesNotMatch(result.stdout, /degreaser-axi setup --help/);
});

test("user-scope removal keeps default harness configuration roots", (t) => {
  const f = setup(t);
  const {
    CODEX_HOME: _codex,
    CLAUDE_CONFIG_DIR: _claude,
    PI_CODING_AGENT_DIR: _pi,
    ...env
  } = f.env;
  for (const remove of [false, true]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        loader,
        cli,
        "setup",
        "hooks",
        "--harnesses",
        "codex,claude,pi,cursor",
        "--installation-scope",
        "user",
        ...(remove ? ["--remove"] : []),
      ],
      { cwd: f.root, env, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.deepEqual(installed(f.home, "user"), {
    codex: false,
    claude: false,
    pi: false,
    cursor: false,
    shared: false,
    claudeSkill: false,
  });
  for (const root of [".codex", ".claude", ".pi/agent", ".cursor"])
    assert.ok(existsSync(join(f.home, root)), root);
});
