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
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { ProjectConfig } from "../src/config.ts";
import type { Run } from "../src/storage.ts";
import { fixture } from "./git-fixture.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const loader = fileURLToPath(
  new URL("./fixtures/public-runtime.mjs", import.meta.url),
);
export interface Event {
  type?: string;
  aspect: string;
  pid: number;
  childPid?: number;
  reviewing?: boolean;
  model: string;
  agent: string;
  sessionId?: string;
  prompt?: string;
  time: number;
  meta?: { claudeCode?: { options?: { maxTurns?: number } } };
  outcome?: { outcome: string; optionId?: string };
}
export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
}
export async function until(check: () => boolean, message: string, ms = 10000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await setTimeout(25);
  assert.ok(check(), message);
}
export function queueFixture(
  t: TestContext,
  config: Partial<ProjectConfig> = {},
) {
  // Process cleanup must precede the Git fixture's directory removal.
  let cleanup = async () => {};
  t.after(() => cleanup());
  const f = fixture(t);
  const external = mkdtempSync(join(tmpdir(), "degreaser-queue-"));
  const plan = join(external, "plan.json");
  const log = join(external, "prompts.jsonl");
  const lifecycleLog = join(external, "lifecycle.jsonl");
  const events = (path: string): Event[] =>
    existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const state = (): Run => {
    const { latestRunId } = JSON.parse(
      readFileSync(join(f.root, ".degreaser/state.json"), "utf8"),
    );
    return JSON.parse(
      readFileSync(
        join(f.root, ".degreaser/runs", latestRunId, "run.json"),
        "utf8",
      ),
    );
  };
  const setPlan = (data: object = {}) =>
    writeFileSync(plan, JSON.stringify({ log, lifecycleLog, ...data }));
  setPlan();
  f.write("source.ts", "// redundant\nexport const value = 1;\n");
  f.write(
    ".degreaserrc.json",
    JSON.stringify({
      agent: "codex",
      model: "gpt-6-luna",
      maxRetries: 0,
      limits: { workerTimeoutSeconds: 15, runTimeoutSeconds: 30 },
      ...config,
    }),
  );
  const run = (args: string[]) => {
    const result = spawnSync(
      process.execPath,
      ["--import", loader, cli, ...args],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 45000,
        env: { ...process.env, SYNTHETIC_PLAN: plan },
      },
    );
    assert.equal(result.error, undefined);
    return result;
  };
  cleanup = async () => {
    if (existsSync(join(f.root, ".degreaser/state.json"))) {
      const owner = state().owner?.pid;
      if (owner && alive(owner)) {
        process.kill(owner, "SIGTERM");
        await until(
          () => !alive(owner),
          "Owned run must exit during fixture cleanup",
        );
      }
    }
    for (const e of events(lifecycleLog)) {
      for (const pid of [e.pid, e.childPid].filter(
        (p): p is number => p !== undefined,
      ))
        assert.ok(!alive(pid), `Owned synthetic process ${pid} leaked`);
    }
    rmSync(external, { recursive: true, force: true });
  };
  return {
    ...f,
    run,
    state,
    setPlan,
    events: () => events(log),
    lifecycle: () => events(lifecycleLog).filter((e) => e.reviewing),
    gate: (name: string) => join(external, name),
    release: (name: string) => writeFileSync(join(external, name), ""),
    start: (extra: string[] = []) =>
      run([
        "review",
        "--scope",
        "worktree",
        "--task",
        "Update source",
        "--wait",
        "1",
        ...extra,
      ]),
    finish: () => run(["wait", state().id, "--wait", "20"]),
  };
}
