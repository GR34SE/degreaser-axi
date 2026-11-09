import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFixture, expectations, task } from "./comment-fixtures.ts";

const [agent, model, dir] = process.argv.slice(2);
if (!agent || !model || !dir)
  throw new Error(
    "Usage: node test/live/support/comment-measure.ts <agent> <model> <dir>",
  );
const cli = fileURLToPath(new URL("../../../dist/main.js", import.meta.url));
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
console.log(
  "Expected verdicts (NOT compared automatically; check them against the report above):",
);
for (const e of expectations)
  console.log(`${e.verdict} ${e.id} ${e.file} "${e.marker}" (${e.note})`);
