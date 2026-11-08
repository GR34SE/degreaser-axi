import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";

import test from "node:test";

import {
  cli,
  defaultSettings,
  explicit,
  loader,
  setup,
  snapshot,
} from "../utils/init-fixture.ts";

for (const existing of [false, true]) {
  test(`non-TTY ${existing ? "reinit" : "first init"} requires all invocation decisions without writes`, (t) => {
    const f = setup(t, existing);
    const before = f.unchanged();
    for (const args of [
      [],
      explicit.slice(0, 4),
      explicit.slice(4),
      ["--agent", "codex"],
      ["--model", "gpt-6-luna"],
    ]) {
      const result = f.run(args);
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stdout, /code: decision-required/);
      assert.match(result.stdout, /candidates/);
      assert.match(result.stdout, /recommendation/);
      assert.match(result.stdout, /codex,gpt-6-luna/);
      // A chosen --agent narrows discovery to that agent's catalog.
      const others = [
        /claude,claude-haiku-4-5-20251001/,
        /pi,openai\/gpt-6-luna/,
        /cursor,composer-2\.5-fast/,
      ];
      for (const other of others)
        if (args.includes("--agent")) assert.doesNotMatch(result.stdout, other);
        else assert.match(result.stdout, other);
      if (!args.includes("--agent"))
        assert.match(
          result.stdout,
          /recommendation:\n {2}agent: claude\n {2}model: claude-haiku-4-5-20251001/,
        );
      assert.match(result.stdout, /degreaser-axi init --agent/);
      assert.equal(result.stderr, "");
      assert.deepEqual(f.unchanged(), before);
    }
    assert.ok(
      f.events().every((e) => e.type !== "prompt" && e.type !== "set-model"),
    );
    for (const { pid } of f.events().filter((e) => e.type === "initialize"))
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
}

test("non-TTY agent-only flags prefill that agent's best-ranked model", (t) => {
  const f = setup(t);
  const result = f.run(["--agent", "codex"]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(
    result.stdout,
    /prefill:\n {2}agent: codex\n {2}model: gpt-6-luna/,
  );
  assert.match(
    result.stdout,
    /degreaser-axi init --agent codex --model 'gpt-6-luna'/,
  );
});

test("explicit selection persists exact identity and preserves RC controls, then review uses it", (t) => {
  const f = setup(t, true);
  const controls = {
    concurrency: 2,
    maxRetries: 0,
    aspects: { "scope-creep": false },
  };
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "codex", model: "gpt-6-luna", ...controls }),
  );
  const chosen = [
    "--agent",
    "claude",
    "--model",
    "claude-haiku-4-5-20251001",
    "--harnesses",
    "pi",
  ];
  const index = readFileSync(join(f.root, ".git/index"));
  for (let i = 0; i < 2; i++) {
    const result = f.run(chosen);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /status: configured/);
    assert.match(result.stdout, /installed/);
    assert.deepEqual(f.config(), {
      schemaVersion: 1,
      agent: "claude",
      model: "claude-haiku-4-5-20251001",
      ...defaultSettings,
      ...controls,
      aspects: { ...defaultSettings.aspects, ...controls.aspects },
    });
  }
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(f.run().status, 2);
  assert.ok(!existsSync(join(f.root, ".degreaser/state.json")));
  assert.ok(existsSync(join(f.root, ".agents/skills/degreaser/SKILL.md")));
  assert.deepEqual(snapshot(f.home), {});
  f.write("sum.ts", "export const sum = (a: number, b: number) => a + b;\n");
  const reviewed = spawnSync(
    process.execPath,
    [
      "--import",
      loader,
      cli,
      "review",
      "--scope",
      "worktree",
      "--task",
      "Add sum",
      "--aspects",
      "low-value-comments",
    ],
    { cwd: f.root, env: f.env, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(reviewed.status, 0, reviewed.stdout);
  assert.deepEqual(
    f
      .events()
      .filter((e) => e.type === "prompt")
      .map((e) => [e.agent, e.model]),
    [["claude", "claude-haiku-4-5-20251001"]],
  );
});

test("explicit --agent probes only that agent's catalog", (t) => {
  const f = setup(t);
  const result = f.run(explicit);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual([...new Set(f.events().map((e) => e.agent))], ["codex"]);
  assert.ok(!existsSync(join(f.home, ".cursor")));
});

test("invalid selections and failed discovery never replace config or create product files", (t) => {
  const f = setup(t, true);
  const before = f.unchanged();
  for (const args of [
    ["--agent", "droid", "--model", "x", "--harnesses", "codex"],
    ["--agent", "claude", "--model", "gpt-6-luna", "--harnesses", "codex"],
    [
      "--agent",
      "pi",
      "--model",
      "other-provider/gpt-6-luna",
      "--harnesses",
      "codex",
    ],
    [...explicit.slice(0, 4), "--harnesses", ""],
    [...explicit.slice(0, 4), "--harnesses", "codex,codex"],
    [...explicit.slice(0, 4), "--harnesses", "droid"],
    [...explicit, "--installation-scope", "invalid"],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /invalid-input/);
    assert.deepEqual(f.unchanged(), before);
  }
  for (const failure of [{ metadataFailure: true }, { noMetadata: true }]) {
    f.setPlan(failure);
    const result = f.run(explicit);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /environment-blocked/);
    assert.doesNotMatch(result.stdout + result.stderr, /private diagnostic/);
    assert.deepEqual(f.unchanged(), before);
  }
  assert.ok(
    f.events().every((e) => e.type !== "prompt" && e.type !== "set-model"),
  );
});

test("malformed or symlinked RC is refused before discovery without overwriting it", (t) => {
  const f = setup(t, true);
  for (const content of [
    "{",
    '{"agent":"codex","model":"gpt-6-luna","unknown":true}',
  ]) {
    f.write(".degreaserrc.json", content);
    const before = f.unchanged();
    assert.equal(f.run(explicit).status, 2);
    assert.deepEqual(f.unchanged(), before);
  }
  const outside = join(f.home, "config.json");
  writeFileSync(outside, '{"agent":"codex","model":"gpt-6-luna"}');
  rmSync(join(f.root, ".degreaserrc.json"));
  symlinkSync(outside, join(f.root, ".degreaserrc.json"));
  assert.equal(f.run(explicit).status, 2);
  assert.equal(
    readFileSync(outside, "utf8"),
    '{"agent":"codex","model":"gpt-6-luna"}',
  );
  assert.deepEqual(f.events(), []);
});

test("a displayed next command is runnable only after explicit user selection", (t) => {
  const f = setup(t);
  const preview = f.run();
  assert.equal(preview.status, 2, preview.stdout);
  const command = preview.stdout.match(
    /degreaser-axi init --agent [^\n,]+/,
  )?.[0];
  assert.ok(command);
  assert.ok(!existsSync(join(f.root, ".degreaserrc.json")));
  const result = spawnSync(
    "/bin/sh",
    [
      "-c",
      command.replace(
        "degreaser-axi",
        `'${process.execPath}' --import '${loader}' '${cli}'`,
      ),
    ],
    {
      cwd: f.root,
      env: f.env,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(f.config(), {
    schemaVersion: 1,
    agent: "claude",
    model: "claude-haiku-4-5-20251001",
    ...defaultSettings,
  });
});

test("init names its uncommitted project files so new worktrees inherit them", (t) => {
  const f = setup(t);
  const first = f.run(explicit);
  assert.equal(first.status, 0, first.stdout);
  for (const file of [
    ".claude/settings.json",
    ".claude/skills/degreaser/SKILL.md",
    ".pi/extensions/degreaser.ts",
  ])
    assert.ok(first.stdout.includes(file), first.stdout);
  assert.match(first.stdout, /new Git worktrees/);
  f.git("add", ".");
  f.git("commit", "--no-gpg-sign", "-m", "Configure Degreaser");
  const again = f.run(explicit);
  assert.equal(again.status, 0, again.stdout);
  assert.doesNotMatch(again.stdout, /uncommitted|new Git worktrees/);
});
