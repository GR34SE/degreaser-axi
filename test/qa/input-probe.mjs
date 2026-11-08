import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const installed = process.argv[2];
await import(
  pathToFileURL(join(installed, "dist/cli/commands/init/prompts.js"))
);
const { prepareReview } = await import(
  pathToFileURL(join(installed, "dist/review/prepare/index.js"))
);
const { createFactory } = await import(
  pathToFileURL(join(installed, "dist/cli/factory.js"))
);
const cwd = mkdtempSync(join(process.argv[3], "input-repo-"));
assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
writeFileSync(join(cwd, ".gitignore"), ".degreaserrc.json\n/.degreaser/\n");
writeFileSync(
  join(cwd, ".degreaserrc.json"),
  JSON.stringify({ agent: "codex", model: "exact-fixture-id" }),
);
writeFileSync(join(cwd, "source"), "installed input smoke\n");
const input = prepareReview(
  createFactory(),
  {
    scope: "worktree",
    task: "Package smoke",
    controls: {},
    pathPatterns: [],
    waitSeconds: 480,
  },
  cwd,
);
assert.equal(input.config.assignments.length, 17);
assert.deepEqual(
  input.paths.map((p) => p.path),
  [".gitignore", "source"],
);
assert.match(input.patch, /\+installed input smoke/);
console.log("Installed input/config schemas and real-Git boundary passed.");
const cli = join(installed, "dist/main.js");
for (const args of [
  [
    "review",
    "--scope",
    "repository",
    "--task",
    "Installed coordinator-only audit",
    "--aspects",
    "scope-creep",
  ],
  ["report", "--full"],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /status: completed/);
  assert.match(result.stdout, /not-applicable/);
}
console.log(
  "Installed detached owner, storage and report passed without model inference.",
);
