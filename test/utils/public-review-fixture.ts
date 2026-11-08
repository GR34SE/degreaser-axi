import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import type { TestContext } from "node:test";

import { fileURLToPath } from "node:url";

import { fixture } from "./git-fixture.ts";

export const cli = fileURLToPath(
  new URL("../../dist/main.js", import.meta.url),
);

export const loader = fileURLToPath(
  new URL("./synthetic-runtime.mjs", import.meta.url),
);

export function setup(t: TestContext, committed = true) {
  const f = fixture(t, committed);
  const external = mkdtempSync(join(tmpdir(), "degreaser-synthetic-"));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const plan = join(external, "plan.json"),
    log = join(external, "events.jsonl");
  const setPlan = (data: object = {}) =>
    writeFileSync(plan, JSON.stringify({ log, ...data }));
  setPlan();
  const run = (args: string[], cwd = f.root) => {
    const result = spawnSync(
      process.execPath,
      ["--import", loader, cli, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, SYNTHETIC_PLAN: plan },
      },
    );
    assert.equal(result.error, undefined);
    return result;
  };
  const input = () => {
    const state = JSON.parse(
      readFileSync(join(f.root, ".degreaser/state.json"), "utf8"),
    );
    return JSON.parse(
      readFileSync(
        join(f.root, ".degreaser/runs", state.latestRunId, "input/review.json"),
        "utf8",
      ),
    );
  };
  const events = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s))
      : [];
  return { ...f, run, input, events, setPlan };
}

export const args = [
  "review",
  "--scope",
  "worktree",
  "--task",
  "Update the source",
  "--aspects",
  "low-value-comments",
];
