import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function checkOnboarding({ repo, home, run }) {
  const status = () => {
    const result = spawnSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: repo, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `Git status failed: ${result.error?.message ?? result.stderr}`,
    );
    return result.stdout;
  };
  const before = status();
  assert.match(run(["init"], 2), /code: decision-required/);
  assert.equal(status(), before);
  assert.deepEqual(readdirSync(home), []);
  assert.match(
    run(
      [
        "init",
        "--agent",
        "codex",
        "--model",
        "gpt-6-luna",
        "--harnesses",
        "claude,pi",
      ],
      0,
    ),
    /status: configured/,
  );
  const config = JSON.parse(
    readFileSync(join(repo, ".degreaserrc.json"), "utf8"),
  );
  assert.equal(config.agent, "codex");
  assert.equal(config.model, "gpt-6-luna");
  for (const path of [
    ".claude/settings.json",
    ".claude/skills/degreaser/SKILL.md",
    ".agents/skills/degreaser/SKILL.md",
    ".pi/extensions/degreaser.ts",
  ])
    assert.ok(
      existsSync(join(repo, path)),
      `Missing selected integration ${path}`,
    );
}
