import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

export function fixture(t: TestContext, committed = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "degreaser-scope-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const write = (path: string, contents: string | Buffer) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  git("init", "--initial-branch=main");
  // Newer Git detaches auto maintenance after commit; it would mutate .git
  // asynchronously and race repository snapshots.
  git("config", "maintenance.auto", "false");
  write(".gitignore", ".degreaserrc.json\nignored/\n.degreaser/\n");
  write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "codex", model: "gpt-6-luna" }),
  );
  if (committed) {
    git("add", ".");
    git("commit", "--no-gpg-sign", "-m", "Fixture base");
  }
  return { root, git, write };
}
