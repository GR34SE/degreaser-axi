import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { fixture } from "./git-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const loader = fileURLToPath(
  new URL("./fixtures/public-runtime.mjs", import.meta.url),
);
const pty = fileURLToPath(new URL("./fixtures/init-pty.py", import.meta.url));
const defaultSettings = {
  concurrency: null,
  maxRetries: 1,
  limits: {
    workerTimeoutSeconds: 300,
    workerIdleSeconds: 120,
    maxTurns: 40,
    runTimeoutSeconds: 900,
  },
  aspects: {
    "missed-reuse": true,
    "unnecessary-layers": true,
    "speculative-flexibility": true,
    "masked-errors": true,
    "unjustified-defense": true,
    "low-value-comments": true,
    "convention-drift": true,
    "scope-creep": true,
    "contract-bypass": true,
    "low-value-tests": true,
    "incomplete-integration": true,
    "wrong-abstraction": true,
    "reinvented-infrastructure": true,
    "unidiomatic-code": true,
    "structural-erosion": true,
    "verification-theater": true,
  },
  exclude: [],
};
const explicit = [
  "--agent",
  "codex",
  "--model",
  "gpt-6-luna",
  "--harnesses",
  "claude,pi",
];

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => [
        join(entry.parentPath, entry.name).slice(root.length),
        entry.isDirectory()
          ? "directory"
          : readFileSync(join(entry.parentPath, entry.name)).toString("base64"),
      ]),
  );
}

function setup(t: TestContext, existing = false) {
  const f = fixture(t);
  if (!existing) rmSync(join(f.root, ".degreaserrc.json"));
  const external = realpathSync(mkdtempSync(join(tmpdir(), "degreaser-init-")));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const home = join(external, "home");
  mkdirSync(home);
  const plan = join(external, "plan.json");
  const log = join(external, "events.jsonl");
  const setPlan = (data: object = {}) =>
    writeFileSync(
      plan,
      JSON.stringify({
        log: join(external, "prompts.jsonl"),
        lifecycleLog: log,
        ...data,
      }),
    );
  setPlan();
  const bin = join(external, "bin");
  mkdirSync(bin);
  for (const agent of ["codex", "claude", "pi"])
    writeFileSync(join(bin, agent), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
    PATH: `${bin}:/usr/bin:/bin`,
    TERM: "xterm-256color",
    CI: "",
    SYNTHETIC_PLAN: plan,
  };
  const run = (
    args: string[] = [],
    answers?: [string | { file: string; contains: string }, string][],
  ) => {
    const result = answers
      ? spawnSync(
          "python3",
          [
            "-B",
            pty,
            JSON.stringify(answers),
            process.execPath,
            "--import",
            loader,
            cli,
            "init",
            ...args,
          ],
          { cwd: f.root, env, encoding: "utf8", timeout: 30_000 },
        )
      : spawnSync(
          process.execPath,
          ["--import", loader, cli, "init", ...args],
          { cwd: f.root, env, encoding: "utf8", timeout: 30_000 },
        );
    assert.equal(result.error, undefined);
    return { ...result, stdout: stripVTControlCharacters(result.stdout) };
  };
  const events = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  const unchanged = () => ({ repo: snapshot(f.root), home: snapshot(home) });
  const config = () =>
    JSON.parse(readFileSync(join(f.root, ".degreaserrc.json"), "utf8"));
  return { ...f, env, home, bin, log, run, events, setPlan, unchanged, config };
}

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

const integrations: [string, string] = [
  "Which agents do you want to install to?",
  "\r",
];
const project: [string, string] = ["Installation scope", "\r"];
const skill: [string, string] = ["get the Degreaser skill?", "\r"];
const acceptAgent: [string, string] = ["agent should run the reviews?", "\r"];
const acceptModel: [string, string] = ["Search models", "\r"];
const install: [string, string] = ["Proceed with installation?", "\r"];

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
