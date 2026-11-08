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
import { fixture } from "../utils/git-fixture.ts";

test("generated skill rejects drift and can be regenerated in isolation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-guidance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["tools", "src"]) {
    cpSync(new URL(`../../${path}`, import.meta.url), join(root, path), {
      recursive: true,
    });
  }
  const asset = join(root, "dist/install/skill/SKILL.md");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "tools/build.ts"), ...args], {
      encoding: "utf8",
    });
  assert.equal(run("--skill-only").status, 0);
  assert.equal(run("--check-skill").status, 0);
  const original = readFileSync(asset, "utf8");
  writeFileSync(asset, `${original}\ndrift\n`);
  const stale = run("--check-skill");
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Generated product skill is stale/);
  assert.equal(run("--skill-only").status, 0);
  assert.equal(run("--check-skill").status, 0);
  assert.equal(readFileSync(asset, "utf8"), original);
});

test("generated review examples execute with explicit task and caller-supplied base", (t) => {
  const f = fixture(t);
  const content = readFileSync(
    new URL("../fixtures/skill-baseline.md", import.meta.url),
    "utf8",
  );
  const commands = [
    ...content.matchAll(/`(degreaser-axi review --scope [^`]+)`/g),
  ].map((match) => match[1] ?? "");
  assert.equal(commands.length, 2);
  const cli = fileURLToPath(new URL("../../dist/main.js", import.meta.url));
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
