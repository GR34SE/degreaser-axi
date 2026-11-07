import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";
import { queueFixture } from "./queue-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const secret = "synthetic-credential-canary-never-real";

test("native diagnostic streams and version suffixes are not public diagnostics", (t) => {
  const f = fixture(t);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "claude", model: "claude-haiku-4-5-20251001" }),
  );
  for (const version of [secret, `2.1.317+${secret}`]) {
    f.write("bin/claude", "");
    writeFileSync(
      join(f.root, "bin/claude"),
      `#!${process.execPath}
console.error(${JSON.stringify(secret)});
console.log(${JSON.stringify(version)});
`,
      { mode: 0o755 },
    );
    chmodSync(join(f.root, "bin/claude"), 0o755);
    const result = spawnSync(process.execPath, [cli, "doctor"], {
      cwd: f.root,
      encoding: "utf8",
      timeout: 15000,
      env: { HOME: f.root, PATH: `${join(f.root, "bin")}:/usr/bin:/bin` },
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /unsupported-native-version/);
    assert.match(result.stdout, /2\.1\.317/);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
    assert.ok(!existsSync(join(f.root, ".degreaser")));
  }
});

test("invalid configuration reports schema constraints without echoing unknown keys or values", (t) => {
  const f = fixture(t);
  for (const extra of [
    { [secret]: secret },
    { aspects: { [secret]: { model: secret } } },
  ]) {
    f.write(
      ".degreaserrc.json",
      JSON.stringify({ agent: "codex", model: "gpt-6-luna", ...extra }),
    );
    for (const args of [[], ["home"], ["doctor"]]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: f.root,
        encoding: "utf8",
        env: { HOME: f.root, PATH: process.env.PATH },
      });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stdout, /\.degreaserrc\.json/);
      assert.ok(!(result.stdout + result.stderr).includes(secret));
    }
  }
  assert.ok(!existsSync(join(f.root, ".degreaser")));
});

test("unexpected local errors use safe diagnostics for commands and the no-args home", (t) => {
  const f = fixture(t);
  const preload = join(f.root, "fault.mjs");
  f.write(
    "fault.mjs",
    `
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const lstat = fs.lstatSync;
fs.lstatSync = function(path, ...args) {
  if (String(path).endsWith("/.degreaser")) throw new Error(process.env.PRIVACY_CANARY);
  return lstat.call(this, path, ...args);
};
syncBuiltinESMExports();
`,
  );
  for (const args of [[], ["home"], ["report"]]) {
    const result = spawnSync(
      process.execPath,
      ["--import", preload, cli, ...args],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 15000,
        env: { HOME: f.root, PATH: process.env.PATH, PRIVACY_CANARY: secret },
      },
    );
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /environment-blocked/);
    assert.match(result.stdout, /unverified|runtime/);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
    assert.ok(!existsSync(join(f.root, ".degreaser")));
  }
});

test("provider errors stay out of every run artifact while literal source evidence survives", (t) => {
  const f = queueFixture(t);
  const quote = "// synthetic-source-canary-intentionally-retained";
  f.write("source.ts", `${quote}\nexport const value = 1;\n`);
  f.setPlan({
    workers: {
      "masked-errors": {
        error: {
          message: `Authentication required: ${secret}`,
          data: { authRequired: true, token: secret },
        },
      },
      "low-value-comments": {
        diagnosticText: secret,
        result: `private assistant preamble ${secret}
<degreaser-result>${JSON.stringify({
          aspect: "low-value-comments",
          status: "findings",
          limitations: [],
          examinedPaths: ["source.ts"],
          findings: [
            {
              location: {
                path: "source.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
              },
              quote,
              title: "Comment repeats the declaration",
              evidence: "The comment supplies no rationale.",
              consequence: "Duplicate maintenance.",
              countercheck: "No external requirement is documented.",
              recommendation: "Remove the comment.",
            },
          ],
        })}</degreaser-result>`,
      },
    },
  });
  const start = f.start(["--aspects", "masked-errors,low-value-comments"]);
  assert.ok([1, 3].includes(start.status ?? -1), start.stdout);
  const done = f.finish();
  assert.equal(done.status, 1, done.stdout);
  const report = f.run(["report", "--full"]);
  const finding = f.run(["finding", "F1"]);
  assert.match(report.stdout, /authentication/);
  assert.ok(finding.stdout.includes(quote));
  for (const result of [start, done, report, finding])
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  const root = join(f.root, ".degreaser");
  const files = readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  }).filter((e) => e.isFile());
  assert.ok(files.length >= 4);
  for (const file of files) {
    const text = readFileSync(join(file.parentPath, file.name), "utf8");
    assert.ok(!text.includes(secret), file.name);
    assert.ok(
      [
        "state.json",
        "run.json",
        "review.json",
        "patch.json",
        "patch.diff",
      ].includes(file.name),
      file.name,
    );
  }
  const input = join(root, "runs", f.state().id, "input");
  assert.ok(readFileSync(join(input, "patch.json"), "utf8").includes(quote));
  assert.ok(readFileSync(join(input, "review.json"), "utf8").includes(quote));
});
