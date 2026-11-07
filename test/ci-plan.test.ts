import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./git-fixture.ts";

const planner = fileURLToPath(
  new URL("../scripts/ci-plan.ts", import.meta.url),
);

test("CI selects documentation only for an entirely allowlisted PR diff; all other events and unknown paths get the full suite", (t) => {
  const f = fixture(t);
  f.write("ignored/outputs", "");
  const output = join(f.root, "ignored/outputs");
  const base = f.git("rev-parse", "HEAD").trim();
  const plan = (event = "pull_request", baseSha = base) => {
    const result = spawnSync(process.execPath, [planner], {
      cwd: f.root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_NAME: event,
        GITHUB_OUTPUT: output,
        CI_BASE_SHA: baseSha,
        CI_HEAD_SHA: f.git("rev-parse", "HEAD").trim(),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const commit = (path: string) => {
    f.write(path, "changed\n");
    f.git("add", ".");
    f.git("commit", "-m", "Change fixture");
  };
  assert.equal(plan().scope, "full", "empty comparisons must not skip tests");
  commit("README.md");
  commit("AGENTS.md");
  assert.equal(plan().scope, "documentation");
  assert.equal(
    readFileSync(output, "utf8").trim().split("\n").at(-1),
    "scope=documentation",
  );
  for (const event of ["push", "schedule", "workflow_dispatch"])
    assert.equal(plan(event).scope, "full");
  assert.equal(plan("pull_request", "0".repeat(40)).scope, "full");
  assert.equal(plan("pull_request", "--output=unexpected").scope, "full");
  for (const path of [
    "assets/worker.md",
    "package.json",
    ".github/workflows/check.yml",
    "test/new.test.ts",
    "line\nbreak.md",
  ]) {
    const previous = f.git("rev-parse", "HEAD").trim();
    commit(path);
    assert.equal(plan("pull_request", previous).scope, "full", path);
  }
  commit("src/new.ts");
  assert.equal(plan().scope, "full");
  assert.equal(
    plan("pull_request", f.git("rev-parse", "HEAD~1").trim()).scope,
    "full",
  );
  f.git("mv", "-f", "src/new.ts", "README.md");
  f.git("commit", "-m", "Rename source into Markdown");
  assert.equal(
    plan("pull_request", f.git("rev-parse", "HEAD~1").trim()).scope,
    "full",
  );
  assert.equal(f.git("status", "--porcelain"), "");
});
