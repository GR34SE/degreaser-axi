// Manual, model-backed measurement of the low-value-comments rubric on the
// held-out fixture. Not part of `pnpm test`; it consumes subscription quota.
// Usage: node scripts/comment-measure.ts <claude|codex> <exact-model> <empty-dir>
// Check fresh quota first and build (`pnpm build`) before running.
import { spawnSync } from "node:child_process";
import { buildFixture, expectations, task } from "./comment-fixtures.ts";

const [agent, model, dir] = process.argv.slice(2);
if (!agent || !model || !dir)
  throw new Error(
    "Usage: node scripts/comment-measure.ts <agent> <model> <dir>",
  );
const cli = new URL("../dist/bin/degreaser-axi.js", import.meta.url).pathname;
const run = (...args: string[]) => {
  const r = spawnSync("node", [cli, ...args], { cwd: dir, encoding: "utf8" });
  console.log(
    `$ degreaser ${args.slice(0, 2).join(" ")} -> exit ${r.status}\n${r.stdout}${r.stderr}`,
  );
  return r;
};
buildFixture(dir);
run("init", "--agent", agent, "--model", model, "--harnesses", agent);
run(
  "review",
  "--scope",
  "worktree",
  "--aspects",
  "low-value-comments",
  "--task",
  task,
  "--wait",
  "600",
);
const id = (run("report").stdout.match(/^run: (\S+)/m) ?? [])[1];
if (id) run("report", id, "--full");
console.log("Expected:");
for (const e of expectations)
  console.log(`${e.verdict} ${e.id} ${e.file} "${e.marker}" (${e.note})`);
