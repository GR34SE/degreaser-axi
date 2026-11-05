import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";

test("generated skill rejects drift and can be regenerated in isolation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-guidance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["scripts", "src", "assets"]) {
    cpSync(new URL(`../${path}`, import.meta.url), join(root, path), {
      recursive: true,
    });
  }
  const asset = join(root, "assets/skills/degreaser/SKILL.md");
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [join(root, "scripts/generate-skill.ts"), ...args],
      {
        encoding: "utf8",
      },
    );
  assert.equal(run("--check").status, 0);
  const original = readFileSync(asset, "utf8");
  assert.doesNotMatch(
    original,
    /installation and automatic gitignore setup remain under development/,
  );
  assert.match(original, /same command session until it exits/i);
  assert.match(original, /no replacement review/i);
  writeFileSync(asset, `${original}\ndrift\n`);
  const stale = run("--check");
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Generated product skill is stale/);
  assert.equal(run().status, 0);
  assert.equal(run("--check").status, 0);
  assert.equal(readFileSync(asset, "utf8"), original);
});

test("generated review examples execute with explicit task and caller-supplied base", (t) => {
  const f = fixture(t);
  const content = readFileSync(
    new URL("../assets/skills/degreaser/SKILL.md", import.meta.url),
    "utf8",
  );
  const commands = [
    ...content.matchAll(/`(degreaser-axi review --scope [^`]+)`/g),
  ].map((match) => match[1] ?? "");
  assert.equal(commands.length, 2);
  const cli = fileURLToPath(
    new URL("../dist/bin/degreaser-axi.js", import.meta.url),
  );
  const index = readFileSync(join(f.root, ".git/index"));
  for (const command of commands) {
    const result = spawnSync(
      "/bin/sh",
      ["-c", command.replace("degreaser-axi", `"$NODE" "$CLI"`)],
      {
        cwd: f.root,
        env: {
          ...process.env,
          NODE: process.execPath,
          CLI: cli,
          USER_PROVIDED_BASE: "HEAD",
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /status: no-changes/);
  }
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
});
