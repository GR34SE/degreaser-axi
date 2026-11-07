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

test("CI selects checks without path filters and requires the static and macOS jobs", () => {
  const workflow = yaml(".github/workflows/check.yml");
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
  ]);
  assert.deepEqual(workflow.on.push, { branches: ["main"] });
  assert.equal(workflow.on.pull_request, null);
  assert.equal(workflow.on.schedule.length, 1);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const { plan, static: lint, macos, check } = workflow.jobs;
  assert.equal(check.name, "macOS deterministic");
  assert.equal(check.if, "always()");
  assert.deepEqual(check.needs, ["plan", "static", "macos"]);
  assert.equal(macos.needs, "plan");
  // Self-hosted labels come only from repository variables, never from the
  // repository itself, and fork PRs always stay on hosted runners.
  const route = (variable: string, hosted: string) =>
    `\${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && vars.${variable} || '${hosted}' }}`;
  assert.equal(lint["runs-on"], route("CI_LINUX_RUNNER", "ubuntu-24.04"));
  assert.equal(macos["runs-on"], route("CI_MACOS_RUNNER", "macos-15"));
  for (const job of [lint, macos]) {
    assert.equal(job.if, undefined);
    assert.equal(job["continue-on-error"], undefined);
    assert.equal(job.permissions, undefined);
    assert.deepEqual(job.env, { CI: "true" });
  }
  assert.match(
    lint.steps.at(-1).run,
    /^pnpm typecheck && pnpm lint$/,
    "static job must typecheck and lint",
  );
  const steps = macos.steps;
  const actions = steps.filter((step: { uses?: string }) => step.uses);
  for (const job of Object.values(workflow.jobs) as {
    steps: { uses?: string; run?: string; name?: string }[];
  }[]) {
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
      if (step.run)
        assert.equal(
          spawnSync("bash", ["-n"], { input: step.run }).status,
          0,
          step.name,
        );
    }
  }
  assert.equal(actions[0].with["persist-credentials"], false);
  assert.equal(plan.steps[0].with["fetch-depth"], 0);
  const pnpm = actions.find((step: { uses: string }) =>
    step.uses.startsWith("pnpm/action-setup@"),
  );
  const current = actions.at(-1);
  assert.ok(steps.indexOf(pnpm) < steps.indexOf(current));
  assert.equal(pnpm.with.run_install, false);
  assert.equal(pnpm.with.version, undefined);
  assert.equal(current.with.cache, "pnpm");
  assert.equal(current.with["cache-dependency-path"], "pnpm-lock.yaml");
  assert.match(current.with["node-version"], /^24\.\d+\.\d+$/);
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  const minimum = steps.findIndex(
    (step: { with?: Record<string, string> }) =>
      step.with?.["node-version"] === "24.0.0",
  );
  assert.equal(steps[minimum].if, "github.event_name != 'pull_request'");
  assert.equal(steps[minimum + 1].if, steps[minimum].if);
  assert.equal(manifest.private, true);
});

test("required aggregate fails for failed, cancelled or skipped dependencies", () => {
  const step = yaml(".github/workflows/check.yml").jobs.check.steps[0];
  const results = ["success", "failure", "cancelled", "skipped"];
  for (const plan of results)
    for (const lint of results)
      for (const macos of results) {
        const result = spawnSync(
          "bash",
          ["-eu", "-o", "pipefail", "-c", step.run],
          {
            env: {
              PATH: process.env.PATH,
              PLAN_RESULT: plan,
              STATIC_RESULT: lint,
              MACOS_RESULT: macos,
            },
          },
        );
        assert.equal(
          result.status === 0,
          [plan, lint, macos].every((value) => value === "success"),
          `${plan}/${lint}/${macos}`,
        );
      }
});

test("CI saves the minimum executable before changing Node, using the runner environment file", (t) => {
  const steps = yaml(".github/workflows/check.yml").jobs.macos.steps;
  const minimum = steps.findIndex(
    (step: { with?: Record<string, string> }) =>
      step.with?.["node-version"] === "24.0.0",
  );
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
