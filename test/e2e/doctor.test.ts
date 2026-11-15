import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hash } from "../../src/util/hash.ts";
import { fixture } from "../utils/git-fixture.ts";

const cli = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

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
      verifier: { model: "gpt-6-sol" },
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
  ])
    assert.ok(result.stdout.includes(expected), expected);
  assert.match(result.stdout, /not a universal no-exec/);
  assert.match(result.stdout, /does not call a model/);
  assert.match(result.stdout, /versionSource: installed-package-manifest/);
  assert.match(result.stdout, /versionSource: native-executable/);
  assert.match(result.stdout, /per-command/);
  assert.doesNotMatch(result.stdout, /status: ready/);
  assert.equal(readFileSync(log, "utf8"), '["--version"]\n["--version"]\n');
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});

test("doctor lists the verifier and checks a distinct verifier identity separately from the workers", (t) => {
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
appendFileSync(${JSON.stringify(log)},${JSON.stringify(agent)}+"\\n");
console.log(${JSON.stringify(version)});
`,
      { mode: 0o755 },
    );
  const doctor = () =>
    spawnSync(process.execPath, [cli, "doctor"], {
      cwd: f.root,
      encoding: "utf8",
      timeout: 15000,
      env: { HOME: f.root, PATH: `${bin}:${process.env.PATH}` },
    });
  const claude = "claude-haiku-4-5-20251001";
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "claude",
      model: claude,
      verifier: { agent: "pi", model: "openai/gpt-6-luna" },
    }),
  );
  const separate = doctor();
  assert.equal(separate.status, 0, separate.stdout + separate.stderr);
  assert.match(
    separate.stdout,
    /verifier:\n {2}agent: pi\n {2}model: openai\/gpt-6-luna/,
  );
  assert.equal(readFileSync(log, "utf8"), "claude\npi\n");
  rmSync(log);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "claude",
      model: claude,
      verifier: { model: claude },
    }),
  );
  const shared = doctor();
  assert.equal(shared.status, 0, shared.stdout + shared.stderr);
  assert.match(shared.stdout, /verifier:\n {2}agent: claude/);
  assert.equal(readFileSync(log, "utf8"), "claude\n");
});

test("typed input errors are not reclassified from user-controlled field names", (t) => {
  const f = fixture(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      verifier: { model: "gpt-6-sol" },
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

test("doctor before init reports the missing RC, native versions and integrations", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, ".degreaserrc.json"));
  const result = spawnSync(process.execPath, [cli, "doctor"], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 15000,
    env: { HOME: f.root, PATH: `/usr/bin:/bin` },
  });
  assert.doesNotMatch(result.stdout, /must exist/);
  assert.match(result.stdout, /configuration: missing/);
  assert.match(result.stdout, /degreaser-axi init/);
  assert.match(result.stdout, /integrations/);
  assert.match(result.stdout, /supportedNativeVersion/);
  assert.ok(!existsSync(join(f.root, ".degreaserrc.json")));
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});

test("doctor's repair for an outdated linked Claude skill keeps the link", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, ".degreaserrc.json"));
  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: f.root,
      encoding: "utf8",
      timeout: 15000,
      env: { HOME: f.root, PATH: `/usr/bin:/bin` },
    });
  const install = run([
    "setup",
    "hooks",
    "--harnesses",
    "claude,codex",
    "--skill-install",
    "link",
  ]);
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const shared = join(f.root, ".agents/skills/degreaser/SKILL.md");
  const receiptPath = join(f.root, ".degreaser/integrations.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  writeFileSync(shared, "older skill");
  receipt.files[shared].hash = hash("older skill");
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const diagnosis = run(["doctor"]);
  assert.match(diagnosis.stdout, /status: outdated/);
  const repair = diagnosis.stdout.match(
    /degreaser-axi (setup hooks --harnesses [^"\n]+)/,
  );
  assert.ok(repair, diagnosis.stdout);
  const repaired = run((repair[1] ?? "").split(" "));
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.ok(
    lstatSync(join(f.root, ".claude/skills/degreaser")).isSymbolicLink(),
  );
  assert.doesNotMatch(run(["doctor"]).stdout, /status: outdated/);
});
