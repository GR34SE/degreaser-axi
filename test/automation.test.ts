import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);

function yaml(path: string) {
  const document = parseDocument(readFileSync(resolve(root, path), "utf8"), {
    uniqueKeys: true,
  });
  assert.deepEqual(document.errors, [], path);
  return document.toJS();
}

test("CI has an unconditional macOS gate with pinned tools and both Node runtimes", () => {
  const workflow = yaml(".github/workflows/check.yml");
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  assert.deepEqual(workflow.on.push, { branches: ["main"] });
  assert.equal(workflow.on.pull_request, null);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["check"]);
  const job = workflow.jobs.check;
  assert.equal(job.name, "macOS deterministic");
  assert.equal(job["runs-on"], "macos-15");
  assert.ok(job["timeout-minutes"] <= 15);
  assert.equal(job.if, undefined);
  assert.equal(job["continue-on-error"], undefined);
  assert.equal(job.permissions, undefined);
  assert.deepEqual(job.env, { CI: "true" });
  const actions = [];
  const commands = [];
  for (const step of job.steps) {
    assert.equal(step.if, undefined);
    assert.equal(step["continue-on-error"], undefined);
    assert.equal(step.env, undefined);
    if (step.uses) {
      assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
      actions.push(step);
    }
    if (step.run) {
      assert.equal(
        spawnSync("bash", ["-n"], { input: step.run }).status,
        0,
        step.name,
      );
      commands.push(step.run.trim());
    }
  }
  assert.deepEqual(
    actions.map((step) => step.uses.split("@")[0]),
    [
      "actions/checkout",
      "actions/setup-node",
      "actions/setup-node",
      "pnpm/action-setup",
    ],
  );
  assert.equal(actions[0].with["persist-credentials"], false);
  const versions = actions
    .filter((step) => step.uses.startsWith("actions/setup-node@"))
    .map((step) => step.with["node-version"]);
  assert.equal(versions[0], "24.0.0");
  assert.match(versions[1], /^24\.\d+\.\d+$/);
  assert.notEqual(versions[1], versions[0]);
  const pnpm = actions.at(-1);
  assert.equal(pnpm.with.run_install, false);
  assert.equal(pnpm.with.version, undefined); // Reads the exact packageManager pin.
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  assert.deepEqual(commands.slice(-2), [
    "pnpm install --frozen-lockfile --ignore-scripts",
    "pnpm check",
  ]);
  assert.equal(commands.length, 4);
  assert.equal(manifest.private, true);
});

test("CI saves the minimum executable before changing Node, using the runner environment file", (t) => {
  const steps = yaml(".github/workflows/check.yml").jobs.check.steps;
  const minimum = steps.findIndex(
    (step: { with?: Record<string, string> }) =>
      step.with?.["node-version"] === "24.0.0",
  );
  const current = steps.findIndex(
    (step: { uses?: string }, index: number) =>
      index > minimum && step.uses?.startsWith("actions/setup-node@"),
  );
  assert.ok(minimum >= 0 && current > minimum + 1);
  const temp = mkdtempSync(resolve(tmpdir(), "degreaser-ci-env-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const environmentFile = resolve(temp, "environment");
  const result = spawnSync(
    "bash",
    ["-eu", "-o", "pipefail", "-c", steps[minimum + 1].run],
    {
      env: { PATH: process.env.PATH, GITHUB_ENV: environmentFile },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const line = readFileSync(environmentFile, "utf8").trim();
  assert.ok(line.startsWith("DEGREASER_NODE24_MIN="), line);
  assert.equal(
    realpathSync(line.slice(line.indexOf("=") + 1)),
    realpathSync(process.execPath),
  );
});

test("dependency updates preserve exact versions, installation policy and bounded PR volume", () => {
  const config = yaml(".github/dependabot.yml");
  const policy = yaml("pnpm-workspace.yaml");
  assert.equal(config.version, 2);
  assert.deepEqual(
    config.updates
      .map(
        (update: { "package-ecosystem": string }) =>
          update["package-ecosystem"],
      )
      .sort(),
    ["github-actions", "npm"],
  );
  for (const update of config.updates) {
    assert.equal(update.directory, "/");
    assert.equal(update.schedule.interval, "weekly");
    assert.ok(
      update["open-pull-requests-limit"] > 0 &&
        update["open-pull-requests-limit"] <= 3,
    );
    assert.ok(
      update.cooldown["default-days"] * 24 * 60 >= policy.minimumReleaseAge,
    );
    assert.equal(update.cooldown.exclude, undefined);
  }
  assert.equal(
    config.updates.find(
      (update: { "package-ecosystem": string }) =>
        update["package-ecosystem"] === "npm",
    )["versioning-strategy"],
    "increase",
  );
  for (const version of Object.values({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }))
    assert.match(String(version), /^\d+\.\d+\.\d+$/);
  assert.equal(policy.ignoreScripts, true);
  assert.equal(policy.verifyDepsBeforeRun, "error");
  assert.ok(policy.minimumReleaseAge >= 10080);
  assert.ok(
    Object.values(policy.allowBuilds).every((allowed) => allowed === false),
  );
});
