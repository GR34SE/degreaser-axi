import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const require = createRequire(import.meta.url);
const codex = createRequire(
  require.resolve("@agentclientprotocol/codex-acp"),
).resolve("@openai/codex/bin/codex.js");

for (const [agent, model, supported] of [
  ["claude", "claude-haiku-4-5-20251001", "2.1.317"],
  ["pi", "openai/gpt-6-luna", "1.4.0"],
] as const) {
  test(`${agent} doctor and review retain exact unsupported-version remediation without dispatch`, (t) => {
    const f = fixture(t);
    const bin = join(f.root, "bin");
    mkdirSync(bin);
    const log = join(f.root, "calls");
    const native = `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+"\\n");
console.log("99.0.0");
`;
    writeFileSync(join(bin, agent), native, { mode: 0o755 });
    f.write(".degreaserrc.json", JSON.stringify({ agent, model }));
    f.write("source.ts", "export const value = 1;\n");
    const before = readFileSync(join(f.root, ".degreaserrc.json"));
    for (const args of [
      ["doctor"],
      [
        "review",
        "--scope",
        "worktree",
        "--task",
        "Review synthetic source",
        "--aspects",
        "low-value-comments",
      ],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: f.root,
        encoding: "utf8",
        timeout: 15000,
        env: { HOME: f.root, PATH: `${bin}:${process.env.PATH}` },
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stdout, /environment-blocked/);
      assert.match(result.stdout, /unsupported-native-version/);
      assert.match(result.stdout, /99\.0\.0/);
      assert.ok(result.stdout.includes(supported), result.stdout);
      assert.match(result.stdout, /PATH/);
      assert.match(result.stdout, /verified|revalidated/);
      assert.doesNotMatch(
        result.stdout,
        /subscription login|Could not discover/,
      );
      assert.ok(!existsSync(join(f.root, ".degreaser")));
    }
    assert.equal(readFileSync(log, "utf8"), '["--version"]\n["--version"]\n');
    assert.equal(readFileSync(join(bin, agent), "utf8"), native);
    assert.deepEqual(readFileSync(join(f.root, ".degreaserrc.json")), before);
  });
}

test("doctor checks configured overrides and installation, not models or ambient sandbox hints", (t) => {
  const f = fixture(t);
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  const log = join(f.root, "calls");
  for (const [agent, version] of [
    ["claude", "2.1.317"],
    ["pi", "1.4.0"],
  ] as const)
    writeFileSync(
      join(bin, agent),
      `#!${process.execPath}
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+"\\n");
if(process.argv.length !== 3 || process.argv[2] !== "--version") process.exit(42);
console.log(${JSON.stringify(version)});
`,
      { mode: 0o755 },
    );
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      aspects: {
        "low-value-comments": {
          agent: "claude",
          model: "claude-haiku-4-5-20251001",
        },
        "verification-theater": { agent: "pi", model: "openai/gpt-6-luna" },
      },
    }),
  );
  const result = spawnSync(process.execPath, [cli, "doctor"], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 15000,
    env: {
      HOME: f.root,
      PATH: `${bin}:${process.env.PATH}`,
      CODEX_SANDBOX: "seatbelt",
      CODEX_SANDBOX_NETWORK_DISABLED: "1",
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const expected of [
    "codex",
    "claude",
    "pi",
    "gpt-6-luna",
    "2.1.317",
    "1.4.0",
    "0.165.0",
    "Read/Grep/Glob",
    "read/grep/find/ls",
    "missing",
    "Unverified",
    "trust",
    "policy",
  ])
    assert.ok(result.stdout.includes(expected), expected);
  assert.match(result.stdout, /not a universal no-exec/);
  assert.match(result.stdout, /does not call a model/);
  assert.match(result.stdout, /per-command/);
  assert.doesNotMatch(result.stdout, /status: ready/);
  assert.equal(readFileSync(log, "utf8"), '["--version"]\n["--version"]\n');
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});

test("missing native dependency is not diagnosed as subscription or permission failure", (t) => {
  const f = fixture(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "pi", model: "openai/gpt-6-luna" }),
  );
  const result = spawnSync(process.execPath, [cli, "doctor"], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 15000,
    env: { HOME: f.root, PATH: "/usr/bin:/bin" },
  });
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /missing-dependency/);
  assert.match(result.stdout, /1\.4\.0/);
  assert.match(result.stdout, /PATH/);
  assert.doesNotMatch(
    result.stdout,
    /diagnosis: permission|diagnosis: authentication/,
  );
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});

test("typed input errors are not reclassified from user-controlled field names", (t) => {
  const f = fixture(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      "permission denied": true,
    }),
  );
  for (const args of [["doctor"], ["doctor", "--permission denied"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: f.root,
      encoding: "utf8",
      env: { HOME: f.root, PATH: process.env.PATH },
    });
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /code: (invalid-input|VALIDATION_ERROR)/);
    assert.doesNotMatch(result.stdout, /diagnosis: permission/);
  }
});

test("native PATH search skips unusable entries but retains a final permission denial", (t) => {
  const f = fixture(t);
  const bad = join(f.root, "bad"),
    good = join(f.root, "good"),
    notDirectory = join(f.root, "file");
  mkdirSync(bad);
  mkdirSync(good);
  writeFileSync(notDirectory, "not a directory");
  writeFileSync(join(bad, "claude"), "not executable", { mode: 0o644 });
  writeFileSync(
    join(good, "claude"),
    `#!${process.execPath}\nconsole.log("2.1.317");\n`,
    { mode: 0o755 },
  );
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "claude", model: "claude-haiku-4-5-20251001" }),
  );
  const run = (path: string) =>
    spawnSync(process.execPath, [cli, "doctor"], {
      cwd: f.root,
      encoding: "utf8",
      timeout: 15000,
      env: { HOME: f.root, PATH: `${path}:/usr/bin:/bin` },
    });
  for (const first of [bad, notDirectory]) {
    const result = run(`${first}:${good}`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /nativeVersion: 2\.1\.317/);
  }
  const blocked = run(bad);
  assert.equal(blocked.status, 2, blocked.stdout);
  assert.match(blocked.stdout, /diagnosis: permission/);
  assert.doesNotMatch(blocked.stdout, /missing-dependency/);
});

test("actual native Codex read-only sandbox refuses review but permits local home and doctor", (t) => {
  const f = fixture(t);
  f.write("source.ts", "export const value = 1;\n");
  const index = readFileSync(join(f.root, ".git/index"));
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        codex,
        "sandbox",
        "--permission-profile",
        ":read-only",
        "-C",
        f.root,
        "--",
        process.execPath,
        cli,
        ...args,
      ],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 20000,
        env: { HOME: f.root, PATH: process.env.PATH },
      },
    );
  const denied = run([
    "review",
    "--scope",
    "worktree",
    "--task",
    "Synthetic source",
    "--aspects",
    "low-value-comments",
  ]);
  assert.equal(denied.status, 2, denied.stdout + denied.stderr);
  assert.match(denied.stdout, /environment-blocked/);
  assert.match(denied.stdout, /diagnosis: permission/);
  assert.match(denied.stdout, /authorized session/);
  assert.ok(!existsSync(join(f.root, ".degreaser")));
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  for (const args of [["home"], ["doctor"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /gpt-6-luna/);
  }
});
