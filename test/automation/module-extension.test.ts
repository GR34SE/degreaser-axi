import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "../utils/git-fixture.ts";

const source = fileURLToPath(new URL("../../", import.meta.url));

test("one new harness and aspect module plus registry entries build and complete a real CLI review without schema edits", (t) => {
  const f = fixture(t);
  const root = join(f.root, "ignored/package");
  mkdirSync(root, { recursive: true });
  for (const name of [
    "src",
    "tools",
    "docs",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.build.json",
  ])
    cpSync(join(source, name), join(root, name), { recursive: true });
  const harness = join(root, "src/modules/harness/trial-harness");
  const aspect = join(root, "src/modules/aspect/trial-aspect");
  mkdirSync(harness);
  mkdirSync(aspect);
  const plan = join(f.root, "ignored/plan.json");
  const launches = join(f.root, "ignored/launches.log");
  f.write(
    "ignored/plan.json",
    JSON.stringify({
      log: join(f.root, "ignored/prompts.log"),
      results: {
        "trial-aspect": {
          aspect: "trial-aspect",
          status: "findings",
          limitations: [],
          findings: [
            {
              location: {
                path: "trial.ts",
                side: "new",
                startLine: 1,
                endLine: 1,
              },
              quote: "// Define trial.",
              title: "Trial finding",
              evidence: "The comment repeats the declaration.",
              consequence: "Duplicate maintenance.",
              countercheck: "No hidden constraint is documented.",
              recommendation: "Remove the comment.",
            },
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(harness, "index.ts"),
    `
import original from "../codex/index.ts";
import { defineHarness } from "../common/definition.ts";
export default defineHarness({
  ...original, id: "trial-harness", displayName: "Trial harness",
  launcher: new URL("./launcher.js", import.meta.url),
  adapterPackage: null,
  configure: async () => "0.165.0",
  guarantee: "Synthetic ACP fixture, not a native isolation claim.",
  limitations: ["Synthetic test harness."],
});
`,
  );
  writeFileSync(
    join(harness, "launcher.ts"),
    `
import { appendFileSync } from "node:fs";
import { replaceCurrentProcess } from "../common/launch.ts";
appendFileSync(${JSON.stringify(launches)}, "trial launcher\\n");
replaceCurrentProcess(process.execPath, [
  process.execPath, ${JSON.stringify(join(source, "test/fixtures/review-acp.mjs"))}, ${JSON.stringify(plan)}
], {
  ...process.env,
  SYNTHETIC_AGENT: "codex",
  SYNTHETIC_MODEL: process.env.DEGREASER_MODEL,
  SYNTHETIC_PURPOSE: process.env.DEGREASER_MODEL_DISCOVERY === "1" ? "model-discovery" : "review",
});
`,
  );
  writeFileSync(
    join(harness, "readme.md"),
    "# Trial harness\n\nSynthetic fixture only.\n",
  );
  writeFileSync(
    join(aspect, "index.ts"),
    `
import { meta as original } from "../low-value-comments/index.ts";
export const meta = { ...original, id: "trial-aspect", title: "Trial aspect" } as const;
export const rubric = new URL("./rubric.md", import.meta.url);
`,
  );
  cpSync(
    join(root, "src/modules/aspect/low-value-comments/rubric.md"),
    join(aspect, "rubric.md"),
  );
  for (const kind of ["harness", "aspect"]) {
    const path = join(root, `src/modules/${kind}/api.ts`);
    const constant = kind === "harness" ? "HARNESSES" : "ASPECTS";
    writeFileSync(
      path,
      `import ${kind === "harness" ? "trial" : "* as trial"} from "./trial-${kind}/index.ts";\n` +
        readFileSync(path, "utf8").replace(
          `${constant} = {`,
          `${constant} = { "trial-${kind}": trial,`,
        ),
    );
  }
  const command = (executable: string, args: string[], cwd = root) => {
    const result = spawnSync(executable, args, {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, CI: "true" },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const node = (args: string[], cwd = root) =>
    command(process.execPath, args, cwd);
  command("pnpm", [
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
  ]);
  node(["tools/generate-docs.ts"]);
  node(["tools/build.ts"]);
  const launcher = join(root, "dist/modules/harness/trial-harness/launcher.js");
  assert.equal(statSync(launcher).mode & 0o111, 0o111);
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "trial-harness",
      model: "exact-codex",
      concurrency: 4,
    }),
  );
  f.write("trial.ts", "// Define trial.\nexport const trial = 1;\n");
  const cli = join(root, "dist/main.js");
  node([cli, "config", "sync"], f.root);
  const config = JSON.parse(
    readFileSync(join(f.root, ".degreaserrc.json"), "utf8"),
  );
  assert.equal(Object.keys(config.aspects).length, 18);
  assert.equal(config.aspects["trial-aspect"], true);
  assert.match(
    readFileSync(join(root, "docs/aspects.md"), "utf8"),
    /trial-aspect/,
  );
  assert.match(
    readFileSync(join(root, "docs/harnesses.md"), "utf8"),
    /Trial harness/,
  );
  assert.match(node([cli, "review", "--help"]), /--aspects/);
  assert.match(node([cli, "init", "--help"]), /trial-harness/);
  const output = node(
    [
      cli,
      "review",
      "--scope",
      "worktree",
      "--task",
      "Review the trial module",
      "--wait",
      "20",
    ],
    f.root,
  );
  assert.match(output, /status: completed/);
  const state = JSON.parse(
    readFileSync(join(f.root, ".degreaser/state.json"), "utf8"),
  );
  const run = JSON.parse(
    readFileSync(
      join(f.root, ".degreaser/runs", state.latestRunId, "run.json"),
      "utf8",
    ),
  );
  assert.equal(run.tasks.length, 18);
  assert.ok(
    run.tasks.every(
      (task: { assignment: { agent: string } }) =>
        task.assignment.agent === "trial-harness",
    ),
  );
  const trial = run.tasks.find(
    (task: { assignment: { aspect: string } }) =>
      task.assignment.aspect === "trial-aspect",
  );
  assert.equal(trial.result.aspect, "trial-aspect");
  assert.equal(trial.status, "findings");
  assert.equal(trial.rejections.length, 0);
  assert.match(node([cli, "report", "--full"], f.root), /trial-aspect/);
  assert.match(node([cli, "finding", "F1"], f.root), /\/\/ Define trial\./);
  assert.ok(readFileSync(launches, "utf8").includes("trial launcher"));
});
