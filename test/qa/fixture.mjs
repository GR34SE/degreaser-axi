import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function scenarioFixture({
  repo,
  external,
  home,
  plan,
  log,
  lifecycleLog,
  node,
  cli,
  environment,
  commands,
  packageRoot,
  runDir,
}) {
  mkdirSync(repo);
  mkdirSync(external);
  mkdirSync(home);
  mkdirSync(join(external, "node_modules"));
  for (const name of ["register.mjs"])
    cpSync(join(root, "test/qa", name), join(external, name));
  cpSync(
    join(root, "test/utils/synthetic-runtime.mjs"),
    join(external, "synthetic-runtime.mjs"),
  );
  for (const name of ["review-acp.mjs", "review-result.mjs"])
    cpSync(join(root, "test/fixtures", name), join(external, name));
  const require = createRequire(join(packageRoot, "package.json"));
  const axiPath = require.resolve
    .paths("axi-sdk-js")
    .map((path) => join(path, "axi-sdk-js", "package.json"))
    .find(existsSync);
  assert.ok(axiPath, "Installed axi-sdk-js is missing");
  const { decode } = createRequire(realpathSync(axiPath))("@toon-format/toon");
  symlinkSync(
    dirname(dirname(require.resolve("acpx/runtime"))),
    join(external, "node_modules/acpx"),
  );
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  const run = (args, status) => {
    const result = spawnSync(node, [cli, ...args], {
      cwd: repo,
      env: environment,
      encoding: "utf8",
      timeout: 60_000,
    });
    commands.push(`${args.join(" ")} => ${result.status ?? "timeout/error"}`);
    assert.equal(result.error, undefined, `${args}: ${result.error}`);
    assert.equal(
      result.status,
      status,
      `${args}: ${result.stdout}\n${result.stderr}`,
    );
    return result.stdout;
  };
  const setPlan = (extra = {}) =>
    writeFileSync(plan, JSON.stringify({ log, lifecycleLog, ...extra }));
  const state = () =>
    JSON.parse(readFileSync(join(repo, ".degreaser/state.json"), "utf8"));
  const currentRun = () =>
    JSON.parse(
      readFileSync(join(runDir, state().latestRunId, "run.json"), "utf8"),
    );
  const finding = {
    location: { path: "source.ts", side: "new", startLine: 1, endLine: 1 },
    quote: "// redundant",
    title: "Redundant comment",
    evidence: "The comment repeats the declaration.",
    consequence: "Extra text to maintain.",
    countercheck: "No constraint is explained.",
    recommendation: "Remove the comment.",
  };

  return { git, run, setPlan, state, currentRun, finding, decode };
}
