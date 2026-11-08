import assert from "node:assert/strict";

import { existsSync, readFileSync, rmSync } from "node:fs";

import { join } from "node:path";

import test from "node:test";

import {
  acceptAgent,
  acceptModel,
  defaultSettings,
  explicit,
  install,
  integrations,
  project,
  setup,
  skill,
} from "../utils/init-fixture.ts";

test("TTY prefills Claude Haiku over Codex without probing unselected agents", (t) => {
  const f = setup(t);
  const result = f.run(
    [],
    [
      [integrations[0], " \r"],
      project,
      skill,
      acceptAgent,
      acceptModel,
      install,
    ],
  );
  assert.equal(result.status, 0, result.stdout);
  assert.equal(f.config().agent, "claude");
  assert.equal(f.config().model, "claude-haiku-4-5-20251001");
  assert.match(result.stdout, /Loading Claude Code models/);
  assert.match(result.stdout, /Claude Code +\/degreaser review my changes/);
  assert.match(result.stdout, /Pi +\/skill:degreaser review my changes/);
  assert.doesNotMatch(result.stdout, /\$degreaser|doctor/);
  assert.doesNotMatch(
    result.stdout,
    /account identity|Native catalogs|found in PATH|Confirm model/,
  );
  assert.ok(!existsSync(join(f.root, ".codex/hooks.json")));
  assert.ok(existsSync(join(f.root, ".claude/skills/degreaser/SKILL.md")));
  assert.deepEqual([...new Set(f.events().map((e) => e.agent))], ["claude"]);
});

test("TTY can change harness and search an exact model, then retains it on reinit", (t) => {
  const f = setup(t);
  const changed = f.run(
    [],
    [
      integrations,
      project,
      skill,
      [acceptAgent[0], "\x1b[A\r"],
      [acceptModel[0], "exact\r"],
      install,
    ],
  );
  assert.equal(changed.status, 0, changed.stdout);
  assert.match(changed.stdout, /Codex +\$degreaser review my changes/);
  assert.match(changed.stdout, /Codex asks you to trust the project/);
  assert.equal(f.config().agent, "codex");
  assert.equal(f.config().model, "exact-codex");
  const again = f.run(
    [],
    [integrations, project, skill, acceptAgent, acceptModel, install],
  );
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /exact-codex \(current/);
  assert.equal(f.config().agent, "codex");
});

test("TTY cancellation before discovery or before installation writes nothing", (t) => {
  const f = setup(t);
  const before = f.unchanged();
  const cancelled = f.run([], [[integrations[0], "\x03"]]);
  assert.equal(cancelled.status, 2, cancelled.stdout);
  assert.match(cancelled.stdout, /Installation cancelled/);
  assert.doesNotMatch(cancelled.stdout, /error:|reason:|help\[/);
  assert.deepEqual(f.events(), []);
  assert.deepEqual(f.unchanged(), before);
  const declined = f.run(
    [],
    [
      integrations,
      project,
      skill,
      acceptAgent,
      acceptModel,
      [install[0], "n\r"],
    ],
  );
  assert.equal(declined.status, 2, declined.stdout);
  assert.match(declined.stdout, /Installation cancelled/);
  assert.doesNotMatch(declined.stdout, /error:|reason:|help\[/);
  assert.deepEqual(f.unchanged(), before);
});

test("TTY absence of harnesses is a short error without discovery or writes", (t) => {
  const f = setup(t);
  for (const agent of ["codex", "claude", "pi"]) rmSync(join(f.bin, agent));
  const before = f.unchanged();
  const result = f.run([], []);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /No supported agent CLI .* found in PATH/);
  assert.deepEqual(f.events(), []);
  assert.deepEqual(f.unchanged(), before);
});

test("TTY Ctrl+C during discovery stops its adapter and leaves files untouched", (t) => {
  const f = setup(t);
  f.setPlan({ metadataHang: true });
  const before = f.unchanged();
  const result = f.run(
    [],
    [
      integrations,
      project,
      skill,
      acceptAgent,
      [{ file: f.log, contains: '"type":"session"' }, "\x03"],
    ],
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Installation cancelled/);
  assert.deepEqual(f.unchanged(), before);
  const processes = f.events().filter((event) => event.type === "initialize");
  assert.equal(processes.length, 1);
  for (const { pid } of processes)
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("TTY falls back to Codex Luna when Claude is absent", (t) => {
  const f = setup(t);
  rmSync(join(f.bin, "claude"));
  const result = f.run(
    [],
    [integrations, project, acceptAgent, acceptModel, install],
  );
  assert.equal(result.status, 0, result.stdout);
  assert.equal(f.config().agent, "codex");
  assert.equal(f.config().model, "gpt-6-luna");
  assert.deepEqual([...new Set(f.events().map((e) => e.agent))], ["codex"]);
});

test("TTY discovery failure leaves configuration untouched", (t) => {
  const f = setup(t);
  f.setPlan({ metadataFailure: true });
  const before = f.unchanged();
  const result = f.run([], [integrations, project, skill, acceptAgent]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /environment-blocked/);
  assert.match(result.stdout, /Claude Code is unavailable: /);
  assert.doesNotMatch(result.stdout, /Log in to it/);
  assert.doesNotMatch(result.stdout, /private diagnostic/);
  assert.deepEqual(f.unchanged(), before);
});

test("unavailable RC is flagged before the user picks a replacement", (t) => {
  const f = setup(t, true);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "codex", model: "withdrawn-model" }),
  );
  const result = f.run(
    [],
    [integrations, project, skill, acceptAgent, acceptModel, install],
  );
  assert.equal(result.status, 0, result.stdout);
  assert.match(
    result.stdout,
    /Previous model withdrawn-model is no longer available from Codex/,
  );
});

test("TTY global selection installs only into the disposable home", (t) => {
  const f = setup(t);
  const result = f.run(
    [],
    [
      integrations,
      [project[0], "\x1b[B\r"],
      skill,
      acceptAgent,
      acceptModel,
      install,
    ],
  );
  assert.equal(result.status, 0, result.stdout);
  assert.ok(existsSync(join(f.home, ".degreaser/integrations.json")));
  assert.ok(!existsSync(join(f.root, ".degreaser/integrations.json")));
});

test("TTY partial flags constrain prefill instead of being silently ignored", (t) => {
  const f = setup(t, true);
  for (const [args, expected, steps] of [
    [["--agent", "pi"], { agent: "pi", model: "openai/gpt-6-luna" }, []],
    [
      ["--model", "exact-codex"],
      { agent: "codex", model: "exact-codex" },
      [acceptAgent],
    ],
  ] as const) {
    const result = f.run(
      [...args],
      [integrations, project, skill, ...steps, acceptModel, install],
    );
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(f.config(), {
      schemaVersion: 1,
      ...expected,
      ...defaultSettings,
    });
  }
});

test("TTY offers to replace a stale Degreaser skill instead of failing", (t) => {
  const f = setup(t);
  assert.equal(f.run(explicit).status, 0);
  f.write(".agents/skills/degreaser/SKILL.md", "older Degreaser skill");
  rmSync(join(f.root, ".degreaser/integrations.json"));
  const steps: [string, string][] = [
    integrations,
    project,
    skill,
    acceptAgent,
    acceptModel,
    install,
  ];
  const kept = f.run([], [...steps, ["Replace it?", "\r"]]);
  assert.equal(kept.status, 2, kept.stdout);
  assert.equal(
    readFileSync(join(f.root, ".agents/skills/degreaser/SKILL.md"), "utf8"),
    "older Degreaser skill",
  );
  const replaced = f.run([], [...steps, ["Replace it?", "y"]]);
  assert.equal(replaced.status, 0, replaced.stdout);
  assert.match(
    readFileSync(join(f.root, ".claude/skills/degreaser/SKILL.md"), "utf8"),
    /name: degreaser/,
  );
});
