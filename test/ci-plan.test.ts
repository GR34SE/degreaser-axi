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

test("CI selects documentation only for an entirely allowlisted PR diff; all other events and unknown paths get every shard", (t) => {
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
  const docs = plan();
  assert.equal(docs.scope, "documentation");
  assert.deepEqual(docs.matrix.include, [
    { lane: "static", shard: "1/1" },
    { lane: "package", shard: "1/1" },
    { lane: "tests", shard: "1/1" },
  ]);
  const outputs = readFileSync(output, "utf8").trim().split("\n");
  assert.equal(outputs.at(-2), "scope=documentation");
  assert.deepEqual(
    JSON.parse(outputs.at(-1)?.slice("matrix=".length) ?? ""),
    docs.matrix,
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
  const full = plan();
  assert.equal(full.scope, "full");
  assert.deepEqual(
    full.matrix.include
      .filter((job: { lane: string }) => job.lane === "tests")
      .map((job: { shard: string }) => job.shard),
    ["1/4", "2/4", "3/4", "4/4"],
  );
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
