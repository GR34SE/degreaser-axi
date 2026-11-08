import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import test from "node:test";

import { cli, installed, setup } from "../utils/integration-fixture.ts";

test("hooks use the bare command when PATH resolves to this install, including pnpm shims", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "degreaser-path-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const command = (path: string) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(new URL("../../dist/install/hook-command.js", import.meta.url).href)}); const {createFactory} = await import(${JSON.stringify(new URL("../../dist/cli/factory.js", import.meta.url).href)}); console.log(m.hookSpec(createFactory()).command);`,
      ],
      { encoding: "utf8", env: { ...process.env, PATH: path } },
    ).stdout;
  assert.match(command(bin), /node' '.*main\.js' startup-context/);
  writeFileSync(
    join(bin, "degreaser-axi"),
    `#!/bin/sh\nexec node "$0" "$@"\n# cmd-shim-target=${cli}\n`,
    { mode: 0o755 },
  );
  assert.match(command(bin), /then 'degreaser-axi' startup-context /);
  assert.match(command(`.:${bin.replace(/^\//, "")}`), /node' '/);
});

test("remove works without the local receipt for provably owned entries and prunes emptied directories", (t) => {
  const f = setup(t);
  f.write(".claude/keep/notes.md", "foreign");
  f.write(".cursor/hooks.json", JSON.stringify({ version: 1, hooks: {} }));
  assert.equal(f.maintenance("codex,claude,pi,cursor").status, 0);
  f.write(".claude/skills/other/SKILL.md", "foreign skill");
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  const removal = f.maintenance("codex,claude,pi,cursor", "project", true);
  assert.equal(removal.status, 0, removal.stdout + removal.stderr);
  for (const gone of [
    ".agents",
    ".codex",
    ".pi",
    ".claude/skills/degreaser",
    ".degreaser",
  ])
    assert.ok(!existsSync(join(f.root, gone)), gone);
  assert.equal(
    readFileSync(join(f.root, ".claude/keep/notes.md"), "utf8"),
    "foreign",
  );
  assert.equal(
    readFileSync(join(f.root, ".claude/skills/other/SKILL.md"), "utf8"),
    "foreign skill",
  );
  assert.ok(!existsSync(join(f.root, ".claude/settings.json")));
});

test("receipt-less remove conflicts on an edited hook that keeps the marker", (t) => {
  const f = setup(t);
  assert.equal(f.maintenance("claude,cursor").status, 0);
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  for (const path of [".claude/settings.json", ".cursor/hooks.json"]) {
    const file = join(f.root, path);
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("startup-context", "edited-context"),
    );
  }
  const edited = readFileSync(join(f.root, ".claude/settings.json"), "utf8");
  for (const harness of ["claude", "cursor"]) {
    const removal = f.maintenance(harness, "project", true);
    assert.equal(removal.status, 2, removal.stdout + removal.stderr);
  }
  assert.equal(
    readFileSync(join(f.root, ".claude/settings.json"), "utf8"),
    edited,
  );
});

test("receipt-less remove takes hooks another install wrote with a different executable", (t) => {
  const f = setup(t);
  assert.equal(f.maintenance("codex,claude,cursor").status, 0);
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  for (const path of [
    ".codex/hooks.json",
    ".claude/settings.json",
    ".cursor/hooks.json",
  ]) {
    const file = join(f.root, path);
    const settings = JSON.parse(readFileSync(file, "utf8"));
    const rewrite = (command: string) =>
      command.replace(
        /then .+ startup-context/,
        "then '/elsewhere/node' '/elsewhere/degreaser-axi.js' startup-context",
      );
    for (const group of settings.hooks.SessionStart ??
      settings.hooks.sessionStart) {
      if (group.command) group.command = rewrite(group.command);
      for (const hook of group.hooks ?? [])
        hook.command = rewrite(hook.command);
    }
    writeFileSync(file, JSON.stringify(settings));
  }
  const removal = f.maintenance("codex,claude,cursor", "project", true);
  assert.equal(removal.status, 0, removal.stdout + removal.stderr);
  const left = installed(f.root, "project");
  assert.deepEqual(
    [left.codex, left.claude, left.cursor, left.shared],
    [false, false, false, false],
  );
});

test("user-scope setup works outside a Git repository", (t) => {
  const f = setup(t);
  const outside = join(f.home, "not-a-repo");
  mkdirSync(outside);
  const result = f.run(
    ["setup", "hooks", "--harnesses", "codex", "--installation-scope", "user"],
    outside,
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(installed(f.home, "user").codex);
  const removal = f.run(
    [
      "setup",
      "hooks",
      "--harnesses",
      "codex",
      "--installation-scope",
      "user",
      "--remove",
    ],
    outside,
  );
  assert.equal(removal.status, 0, removal.stdout + removal.stderr);
  assert.ok(!installed(f.home, "user").codex);
});

test("receipt-less remove keeps the shared skill a linked Claude still reads", (t) => {
  const f = setup(t);
  const linked = f.run([
    "setup",
    "hooks",
    "--harnesses",
    "claude,codex",
    "--skill-install",
    "link",
  ]);
  assert.equal(linked.status, 0, linked.stdout + linked.stderr);
  rmSync(join(f.root, ".degreaser"), { recursive: true });
  const removal = f.maintenance("codex", "project", true);
  assert.equal(removal.status, 0, removal.stdout + removal.stderr);
  assert.ok(!installed(f.root, "project").codex);
  assert.ok(installed(f.root, "project").claudeSkill);
});
