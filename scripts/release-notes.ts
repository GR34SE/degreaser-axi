import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { since: { type: "string" } },
});
assert.ok(
  values.since,
  "Pass --since <commit-or-tag>; no release base is guessed.",
);
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 10_000 }).trim();
const base = git(
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${values.since}^{commit}`,
);
const head = git("rev-parse", "--verify", "HEAD");
git("merge-base", "--is-ancestor", base, head);
const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
const changes = git(
  "log",
  "--reverse",
  "--format=- %s (%h)",
  `${base}..${head}`,
);
process.stdout.write(
  `# ${name} ${version}\n\nLocal preparation only, not published.\n` +
    `Review these commit subjects before sharing; they are not curated release notes.\n\n` +
    `Base: ${base}\nCommit: ${head}\n\n## Changes\n\n` +
    `${changes || "No commits in the selected range."}\n`,
);
