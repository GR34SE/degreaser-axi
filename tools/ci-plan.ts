import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

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
console.log(JSON.stringify({ scope }));
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
