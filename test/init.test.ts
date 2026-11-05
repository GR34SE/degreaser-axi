import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const loader = fileURLToPath(
  new URL("./fixtures/public-runtime.mjs", import.meta.url),
);
const pty = fileURLToPath(new URL("./fixtures/init-pty.py", import.meta.url));
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
  const external = mkdtempSync(join(tmpdir(), "degreaser-init-"));
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
  const env = { ...process.env, HOME: home, SYNTHETIC_PLAN: plan };
  const run = (args: string[] = [], answers?: string[]) => {
    const result = answers
      ? spawnSync(
          "python3",
          [
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
    return result;
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
  return { ...f, env, home, run, events, setPlan, unchanged, config };
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
      assert.match(result.stdout, /error: decision-required/);
      assert.match(result.stdout, /candidates/);
      assert.match(result.stdout, /recommendation/);
      assert.match(result.stdout, /codex,gpt-6-luna/);
      assert.match(result.stdout, /claude,claude-haiku-4-5-20251001/);
      assert.match(result.stdout, /pi,openai\/gpt-6-luna/);
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

test("explicit selection persists exact identity and preserves RC controls, then review uses it", (t) => {
  const f = setup(t, true);
  const controls = {
    concurrency: 2,
    maxRetries: 0,
    aspects: { disable: ["A08"] },
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
    assert.match(result.stdout, /not installed/);
    assert.deepEqual(f.config(), {
      schemaVersion: 1,
      agent: "claude",
      model: "claude-haiku-4-5-20251001",
      ...controls,
    });
  }
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.equal(f.run().status, 2);
  assert.ok(!existsSync(join(f.root, ".degreaser")));
  assert.ok(!existsSync(join(f.root, ".agents")));
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
      "A06",
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

test("TTY first init and reinit require confirm or change, keeping RC only as prefill", (t) => {
  const f = setup(t);
  const first = f.run([], ["\n", "claude,pi\n"]);
  assert.equal(first.status, 0, first.stdout);
  assert.match(first.stdout, /Confirm model \[codex\/gpt-6-luna\]/);
  assert.equal(f.config().model, "gpt-6-luna");
  const changed = f.run([], ["3\n", "codex\n"]);
  assert.equal(changed.status, 0, changed.stdout);
  assert.equal(f.config().agent, "claude");
  assert.equal(f.config().model, "claude-haiku-4-5-20251001");
  const again = f.run([], ["\n", "\n"]);
  assert.equal(again.status, 0, again.stdout);
  assert.match(
    again.stdout,
    /Confirm model \[claude\/claude-haiku-4-5-20251001\]/,
  );
  assert.equal(f.config().agent, "claude");
});

test("TTY cancellation or invalid answer has no writes", (t) => {
  const f = setup(t);
  const before = f.unchanged();
  for (const answers of [["\x04"], ["999\n"], ["\n", "droid\n"]]) {
    const result = f.run([], answers);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /Confirm model/);
    assert.match(result.stdout, /decision-required|invalid-input/);
    assert.deepEqual(f.unchanged(), before);
  }
});

test("TTY discovery failure is actionable before any empty model prompt", (t) => {
  const f = setup(t);
  f.setPlan({ metadataFailure: true });
  const before = f.unchanged();
  const result = f.run([], []);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /codex.*unavailable/);
  assert.match(result.stdout, /subscription login and host permissions/);
  assert.doesNotMatch(result.stdout, /Confirm model/);
  assert.deepEqual(f.unchanged(), before);
});

test("unavailable RC remains prefill, not a silently replaced selection", (t) => {
  const f = setup(t, true);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "codex", model: "withdrawn-model" }),
  );
  const before = f.unchanged();
  const refused = f.run([], ["\n", "\n"]);
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stdout, /Confirm model \[codex\/withdrawn-model\]/);
  assert.match(refused.stdout, /exact model list/);
  assert.deepEqual(f.unchanged(), before);
  const changed = f.run([], ["1\n", "codex\n"]);
  assert.equal(changed.status, 0, changed.stdout);
  assert.equal(f.config().model, "gpt-6-luna");
});

test("a failed harness catalog is disclosed without blocking an explicitly chosen available harness", (t) => {
  const f = setup(t);
  f.setPlan({ metadataFailureAgents: ["codex"] });
  const result = f.run([], ["\n", "pi\n"]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /codex: unavailable/);
  assert.match(
    result.stdout,
    /Confirm model \[claude\/claude-haiku-4-5-20251001\]/,
  );
  assert.equal(f.config().agent, "claude");
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
    agent: "codex",
    model: "gpt-6-luna",
  });
});

test("TTY partial flags constrain prefill instead of being silently ignored", (t) => {
  const f = setup(t, true);
  for (const [args, expected] of [
    [["--agent", "pi"], { agent: "pi", model: "openai/gpt-6-luna" }],
    [["--model", "exact-codex"], { agent: "codex", model: "exact-codex" }],
  ] as const) {
    const result = f.run([...args], ["\n", "codex\n"]);
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(f.config(), { schemaVersion: 1, ...expected });
  }
});
