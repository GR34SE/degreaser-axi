import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

// Only these standalone documents can bypass the runtime regression suite.
const documentation = new Set(["README.md", "AGENTS.md"]);
let scope = "full";
const base = process.env.CI_BASE_SHA ?? "";
const head = process.env.CI_HEAD_SHA ?? "";
if (
  process.env.GITHUB_EVENT_NAME === "pull_request" &&
  /^[a-f0-9]{40}$/.test(base) &&
  /^[a-f0-9]{40}$/.test(head)
) {
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", base, head, "--"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (!diff.error && diff.status === 0) {
    const paths = diff.stdout.split("\0").filter(Boolean);
    if (paths.length > 0 && paths.every((path) => documentation.has(path)))
      scope = "documentation";
  }
}
const matrix = {
  include: [
    { lane: "static", shard: "1/1" },
    { lane: "package", shard: "1/1" },
    ...(scope === "documentation" ? ["1/1"] : ["1/4", "2/4", "3/4", "4/4"]).map(
      (shard) => ({ lane: "tests", shard }),
    ),
  ],
};
console.log(JSON.stringify({ scope, matrix }));
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `scope=${scope}\nmatrix=${JSON.stringify(matrix)}\n`,
  );
