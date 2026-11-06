import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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
const consumer = readFileSync(
  new URL("./fixtures/pi-metadata.mjs", import.meta.url),
  "utf8",
);
const unsupported = "other-provider/gpt-6-luna";

function setup(t: TestContext) {
  const f = fixture(t);
  const home = mkdtempSync(join(tmpdir(), "degreaser-pi-admission-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "pi"), `#!${process.execPath}\n${consumer}`, {
    mode: 0o755,
  });
  const settings = join(home, ".pi/agent/settings.json");
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  const original = '{"defaultProvider":"openai","defaultModel":"gpt-6-luna"}\n';
  writeFileSync(settings, original);
  const plan = (value: object = {}) =>
    writeFileSync(join(home, "plan.json"), JSON.stringify(value));
  plan();
  f.write("source.ts", "export const value = 1;\n");
  const config = (value: object) =>
    f.write(".degreaserrc.json", JSON.stringify(value));
  config({ agent: "pi", model: unsupported });
  const run = (aspects = "low-value-comments") => {
    const rc = readFileSync(join(f.root, ".degreaserrc.json"));
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "review",
        "--scope",
        "repository",
        "--task",
        "Synthetic audit",
        "--aspects",
        aspects,
      ],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 15000,
        env: { HOME: home, PATH: `${home}:${process.env.PATH}` },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(readFileSync(settings, "utf8"), original);
    assert.deepEqual(readFileSync(join(f.root, ".degreaserrc.json")), rc);
    return result;
  };
  const events = () =>
    readFileSync(join(home, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { ...f, home, config, run, events, plan };
}

test("unselected Pi discovery uses the real profile and adapter without a model or persistent setter", (t) => {
  const f = setup(t);
  const module = new URL("../dist/src/model-discovery.js", import.meta.url)
    .href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {discoverModels} from ${JSON.stringify(module)};
     console.log(JSON.stringify(await discoverModels({agent:"pi"}, process.cwd(), 5000)));`,
    ],
    {
      cwd: f.root,
      env: { HOME: f.home, PATH: `${f.home}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).availableModelIds, [
    "openai/gpt-6-luna",
  ]);
  assert.ok(f.events().some((event) => event.type === "get_available_models"));
  assert.ok(
    f
      .events()
      .every((event) => event.type !== "prompt" && event.type !== "set_model"),
  );
  for (const event of f.events().filter((e) => e.type === "launch"))
    assert.ok(!event.args.includes("--model"));
});

for (const override of [false, true]) {
  test(`public Pi ${override ? "override" : "pair"} uses independent native metadata before admission`, (t) => {
    const f = setup(t);
    if (override)
      f.config({
        agent: "codex",
        model: "gpt-6-luna",
        aspects: {
          overrides: {
            "low-value-comments": { agent: "pi", model: unsupported },
          },
        },
      });
    const result = f.run();
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /code: invalid-input/);
    assert.match(result.stdout, /low-value-comments.*pi.*exact model list/);
    assert.ok(!existsSync(join(f.root, ".degreaser")));
    assert.ok(
      f.events().some((event) => event.type === "get_available_models"),
    );
    assert.ok(
      f
        .events()
        .every(
          (event) => event.type !== "prompt" && event.type !== "set_model",
        ),
    );
    for (const { pid } of f.events())
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
}

test("Pi refusal preserves existing history and does not mistake native faults for invalid models", (t) => {
  const f = setup(t);
  assert.equal(f.run("scope-creep").status, 0);
  const statePath = join(f.root, ".degreaser/state.json");
  const state = readFileSync(statePath);
  const runsPath = join(f.root, ".degreaser/runs");
  const runs = readdirSync(runsPath);
  assert.equal(runs.length, 1);
  const [runId] = runs;
  assert.ok(runId);
  const runPath = join(runsPath, runId, "run.json");
  const previous = readFileSync(runPath);
  f.config({ agent: "pi", model: "anthropic/gpt-6-luna" });
  for (const [plan, expected] of [
    [{}, "invalid-input"],
    [{ unauthenticated: true }, "environment-blocked"],
    [{ metadataFailure: true }, "environment-blocked"],
    [{ wrongVersion: true }, "environment-blocked"],
  ] as const) {
    f.plan(plan);
    const result = f.run();
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, new RegExp(`code: ${expected}`));
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /Synthetic private diagnostic/,
    );
    assert.deepEqual(readFileSync(statePath), state);
    assert.deepEqual(readdirSync(runsPath), runs);
    assert.deepEqual(readFileSync(runPath), previous);
  }
  assert.ok(
    f
      .events()
      .every((event) => event.type !== "prompt" && event.type !== "set_model"),
  );
  for (const { pid } of f.events())
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("Pi review pins the admitted identity and refuses native substitution before prompting", (t) => {
  const f = setup(t);
  f.config({ agent: "pi", model: "openai/gpt-6-luna" });
  f.plan({ runtimeModelMismatch: true });
  const result = f.run();
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /model-unavailable/);
  const launches = f
    .events()
    .filter(
      (event) => event.type === "launch" && !event.args.includes("--version"),
    );
  assert.equal(launches.length, 2);
  assert.ok(!launches[0].args.includes("--model"));
  const args = launches[1].args;
  assert.equal(args[args.indexOf("--model") + 1], "openai/gpt-6-luna");
  assert.ok(
    f
      .events()
      .every((event) => event.type !== "prompt" && event.type !== "set_model"),
  );
  for (const { pid } of launches)
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
