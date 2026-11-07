import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { data, Evaluator, Lexer, Parser } from "@actions/expressions";
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

test("CI selects checks without path filters and requires every macOS lane", () => {
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
  const { plan, validate, check } = workflow.jobs;
  assert.equal(check.name, "macOS deterministic");
  assert.equal(check.if, "always()");
  assert.deepEqual(check.needs, ["plan", "validate"]);
  assert.equal(validate.needs, "plan");
  assert.equal(validate["runs-on"], "macos-15");
  assert.equal(validate.strategy["fail-fast"], false);
  assert.equal(validate.if, undefined);
  assert.equal(validate["continue-on-error"], undefined);
  assert.equal(validate.permissions, undefined);
  assert.deepEqual(validate.env, { CI: "true" });
  const steps = validate.steps;
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
  assert.equal(
    steps[minimum].if,
    "matrix.lane == 'package' && github.event_name != 'pull_request'",
  );
  assert.equal(steps[minimum + 1].if, steps[minimum].if);
});

test("required aggregate fails for failed, cancelled or skipped dependencies", () => {
  const step = yaml(".github/workflows/check.yml").jobs.check.steps[0];
  for (const plan of ["success", "failure", "cancelled", "skipped"])
    for (const validate of ["success", "failure", "cancelled", "skipped"]) {
      const result = spawnSync(
        "bash",
        ["-eu", "-o", "pipefail", "-c", step.run],
        {
          env: {
            PATH: process.env.PATH,
            PLAN_RESULT: plan,
            VALIDATE_RESULT: validate,
          },
        },
      );
      assert.equal(
        result.status === 0,
        plan === "success" && validate === "success",
        `${plan}/${validate}`,
      );
    }
});

test("CI saves the minimum executable before changing Node, using the runner environment file", (t) => {
  const steps = yaml(".github/workflows/check.yml").jobs.validate.steps;
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
  const config = JSON.parse(
    readFileSync(resolve(root, "renovate.json"), "utf8"),
  );
  const policy = yaml("pnpm-workspace.yaml");
  assert.equal(existsSync(resolve(root, ".github/dependabot.yml")), false);
  assert.deepEqual(config.enabledManagers, ["npm", "github-actions"]);
  assert.equal(config.rangeStrategy, "pin");
  assert.equal(config.minimumReleaseAge, "7 days");
  assert.equal(config.minimumReleaseAgeBehaviour, "timestamp-required");
  assert.equal(config.internalChecksFilter, "strict");
  assert.equal(config.ignoreScripts, true);
  assert.equal(
    config.vulnerabilityAlerts.minimumReleaseAge,
    config.minimumReleaseAge,
  );
  assert.equal(config.vulnerabilityAlerts.rangeStrategy, "pin");
  assert.ok(config.prConcurrentLimit > 0 && config.prConcurrentLimit <= 3);
  assert.equal(config.automerge, false);
  assert.equal(config.automergeType, "pr");
  assert.equal(config.platformAutomerge, true);
  const rules = config.packageRules;
  assert.ok(
    rules.some(
      (rule: { matchUpdateTypes?: string[]; automerge?: boolean }) =>
        rule.automerge === true &&
        JSON.stringify(rule.matchUpdateTypes) ===
          JSON.stringify(["minor", "patch", "pin", "digest"]),
    ),
  );
  assert.ok(
    rules.some(
      (rule: { matchCurrentVersion?: string; automerge?: boolean }) =>
        rule.matchCurrentVersion === "/^0\\./" && rule.automerge === false,
    ),
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

test("release publication is opt-in and uses the tested artifact after preparation", () => {
  const workflow = yaml(".github/workflows/release.yml");
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ["Checks"],
    types: ["completed"],
    branches: ["main"],
  });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const { release, prepare, publish, finalize } = workflow.jobs;
  const github = {
    ref: "refs/heads/main",
    repository: "fixture/fixture",
    event_name: "workflow_run",
    event: {
      workflow_run: {
        conclusion: "success",
        event: "push",
        head_repository: { full_name: "fixture/fixture" },
      },
    },
  };
  for (const enabled of ["", "false", "true"]) {
    assert.equal(
      evaluate(release.if, {
        github,
        vars: { RELEASE_AUTOMATION_ENABLED: enabled },
      }),
      enabled === "true",
    );
    assert.equal(
      evaluate(publish.if, { vars: { NPM_PUBLISH_ENABLED: enabled } }),
      enabled === "true",
    );
  }
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    const event = {
      workflow_run: { ...github.event.workflow_run, conclusion },
    };
    assert.equal(
      evaluate(release.if, {
        github: { ...github, event },
        vars: { RELEASE_AUTOMATION_ENABLED: "true" },
      }),
      false,
    );
  }
  for (const untrusted of [
    { ...github, ref: "refs/heads/feature" },
    {
      ...github,
      event: {
        workflow_run: { ...github.event.workflow_run, event: "pull_request" },
      },
    },
    {
      ...github,
      event: {
        workflow_run: {
          ...github.event.workflow_run,
          head_repository: { full_name: "fork/fixture" },
        },
      },
    },
  ]) {
    assert.equal(
      evaluate(release.if, {
        github: untrusted,
        vars: { RELEASE_AUTOMATION_ENABLED: "true" },
      }),
      false,
    );
  }
  assert.equal(prepare.needs, "release");
  assert.equal(prepare["runs-on"], "macos-15");
  assert.deepEqual(publish.needs, ["release", "prepare"]);
  assert.equal(publish.if, "vars.NPM_PUBLISH_ENABLED == 'true'");
  assert.equal(publish.environment, "npm");
  assert.deepEqual(publish.permissions, {
    contents: "read",
    "id-token": "write",
  });
  assert.equal(publish.env.NODE_AUTH_TOKEN, "");
  assert.deepEqual(finalize.needs, ["release", "publish"]);
  assert.equal(finalize.if, undefined);
  const upload = prepare.steps.find((step: { uses?: string }) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  for (const job of [publish, finalize]) {
    const download = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    assert.equal(download.with.name, upload.with.name);
  }
  assert.equal(manifest.private, false);
  assert.equal(manifest.publishConfig.access, "public");
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
});

function evaluate(expression: string, context: object) {
  const { tokens } = new Lexer(expression).lex();
  const ast = new Parser(tokens, Object.keys(context), []).parse();
  return (
    new Evaluator(ast, JSON.parse(JSON.stringify(context), data.reviver))
      .evaluate()
      .coerceString() === "true"
  );
}
