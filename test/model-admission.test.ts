import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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
const args = [
  "review",
  "--scope",
  "worktree",
  "--task",
  "Synthetic source review",
  "--aspects",
  "A06",
];

function setup(t: TestContext) {
  const f = fixture(t);
  const external = mkdtempSync(join(tmpdir(), "degreaser-admission-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const plan = join(external, "plan.json"),
    lifecycleLog = join(external, "lifecycle.jsonl");
  const setPlan = (data: object = {}) =>
    writeFileSync(
      plan,
      JSON.stringify({
        log: join(external, "prompts.jsonl"),
        lifecycleLog,
        ...data,
      }),
    );
  setPlan();
  const run = (argv = args) => {
    const result = spawnSync(
      process.execPath,
      ["--import", loader, cli, ...argv],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          HOME: external,
          SYNTHETIC_PLAN: plan,
          ACPX_AUTH_OPENAI_API_KEY: "synthetic-secret",
        },
      },
    );
    assert.equal(result.error, undefined);
    return result;
  };
  const events = () =>
    existsSync(lifecycleLog)
      ? readFileSync(lifecycleLog, "utf8")
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s))
      : [];
  const config = (value: object) =>
    f.write(".degreaserrc.json", JSON.stringify(value));
  return { ...f, run, config, events, setPlan };
}

for (const override of [false, true]) {
  test(`public incompatible ${override ? "aspect override" : "top-level pair"} refuses before run admission`, (t) => {
    const f = setup(t);
    f.write("source.ts", "export const value = 1;\n");
    f.config(
      override
        ? {
            agent: "codex",
            model: "gpt-6-luna",
            aspects: {
              overrides: { A06: { agent: "claude", model: "gpt-6-luna" } },
            },
          }
        : { agent: "claude", model: "gpt-6-luna" },
    );
    const rc = readFileSync(join(f.root, ".degreaserrc.json"));
    const result = f.run();
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /error: invalid-input/);
    assert.match(result.stdout, /A06.*claude.*exact model list/);
    assert.ok(!existsSync(join(f.root, ".degreaser")));
    assert.deepEqual(readFileSync(join(f.root, ".degreaserrc.json")), rc);
    assert.deepEqual(
      f
        .events()
        .filter((e) => e.type === "session")
        .map((e) => [e.agent, e.admitted]),
      [["claude", false]],
    );
    assert.ok(
      f.events().every((e) => e.type !== "prompt" && e.type !== "set-model"),
    );
  });
}

test("public admission discovers only selected exact identities, deduplicates and preserves prior history on refusal", (t) => {
  const f = setup(t);
  f.write("source.ts", "export const value = 1;\n");
  f.config({
    agent: "codex",
    model: "gpt-6-luna",
    aspects: {
      overrides: {
        A01: { model: "unselected-model" },
        A04: { model: "exact-codex" },
        A09: { agent: "claude", model: "claude-haiku-4-5-20251001" },
        A16: { agent: "pi", model: "openai/gpt-6-luna" },
      },
    },
  });
  const result = f.run([...args.slice(0, -1), "A04,A05,A06,A09,A16"]);
  assert.equal(result.status, 0, result.stdout);
  const sessions = f
    .events()
    .filter((e) => e.type === "session" && !e.admitted);
  assert.deepEqual(
    sessions.map((e) => [e.agent, e.model]),
    [
      ["codex", "exact-codex"],
      ["codex", "gpt-6-luna"],
      ["claude", "claude-haiku-4-5-20251001"],
      ["pi", "openai/gpt-6-luna"],
    ],
  );
  assert.equal(f.events().filter((e) => e.type === "prompt").length, 5);
  assert.deepEqual(
    f
      .events()
      .filter((e) => e.type === "prompt")
      .map((e) => `${e.agent}/${e.model}`)
      .sort(),
    [
      "claude/claude-haiku-4-5-20251001",
      "codex/exact-codex",
      "codex/gpt-6-luna",
      "codex/gpt-6-luna",
      "pi/openai/gpt-6-luna",
    ],
  );
  assert.ok(
    f.events().every((e) => e.type !== "set-model" || e.agent !== "pi"),
  );
  for (const event of f.events().filter((e) => e.type === "initialize")) {
    assert.deepEqual(event.inheritedAuth, []);
    assert.deepEqual(event.capabilities.fs, {
      readTextFile: false,
      writeTextFile: false,
    });
    assert.equal(event.capabilities.terminal, false);
  }
  const state = readFileSync(join(f.root, ".degreaser/state.json"));
  const runs = readdirSync(join(f.root, ".degreaser/runs"));
  const prompts = f.events().filter((e) => e.type === "prompt").length;
  f.config({ agent: "pi", model: "other-provider/gpt-6-luna" });
  assert.equal(f.run().status, 2);
  assert.deepEqual(readFileSync(join(f.root, ".degreaser/state.json")), state);
  assert.deepEqual(readdirSync(join(f.root, ".degreaser/runs")), runs);
  assert.equal(f.events().filter((e) => e.type === "prompt").length, prompts);
});

test("public syntax errors, empty diff and coordinator-only audit skip metadata discovery", (t) => {
  const f = setup(t);
  f.setPlan({ metadataFailure: true });
  assert.equal(f.run(["review"]).status, 2);
  const empty = f.run();
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /no-changes/);
  const audit = f.run([
    "review",
    "--scope",
    "repository",
    "--task",
    "Audit",
    "--aspects",
    "A08",
  ]);
  assert.equal(audit.status, 0, audit.stdout);
  assert.deepEqual(f.events(), []);
});

test("public metadata failures refuse explicitly and join discovery without creating history", (t) => {
  const f = setup(t);
  f.write("source.ts", "export const value = 1;\n");
  f.config({
    agent: "codex",
    model: "gpt-6-luna",
    limits: { workerTimeoutSeconds: 1 },
  });
  for (const plan of [
    { metadataFailure: true },
    { noMetadata: true },
    { metadataHang: true },
  ]) {
    f.setPlan(plan);
    const result = f.run();
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /environment-blocked/);
    assert.match(result.stdout, /model metadata/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private diagnostic|synthetic-secret/,
    );
    assert.ok(!existsSync(join(f.root, ".degreaser")));
  }
  assert.ok(f.events().every((e) => e.type !== "prompt"));
  for (const { pid } of f.events().filter((e) => e.type === "initialize"))
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("public runtime refuses an absent advertised model after admission without fallback or retry (synthetic Codex catalog)", (t) => {
  const f = setup(t);
  f.write("source.ts", "export const value = 1;\n");
  f.setPlan({ runtimeModels: ["exact-codex"] });
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /model-unavailable/);
  assert.deepEqual(
    f
      .events()
      .filter((e) => e.type === "session")
      .map((e) => e.admitted),
    [false, true],
  );
  assert.ok(f.events().every((e) => e.type !== "prompt"));
});
