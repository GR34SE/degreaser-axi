import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Agent } from "../src/config.ts";
import { ownerAlive } from "../src/ownership.ts";
import type { Run } from "../src/storage.ts";
import { CallerEvidence } from "./caller-evidence.ts";
import { stopCursorAt } from "./cursor-process.ts";
import { nativeCaller } from "./live-caller-native.ts";

const cli = fileURLToPath(
  new URL("../dist/bin/degreaser-axi.js", import.meta.url),
);
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const command = `${quote(process.execPath)} ${quote(cli)}`;
const contextQuestion =
  'From the Degreaser startup context already delivered to you, respond before ANY tool call with one JSON line prefixed STARTUP. Keys: history, model, run, status. Set history="none" if it says no local run yet (run=null and status=null); history="known" only if an actual last-run ID was delivered; history="unavailable" if the startup context is missing. Copy model exactly from the Review model field without its harness prefix. Preserve aliases literally; do not resolve them or report your own inference model. Run and status are the delivered last-run ID/status, or real JSON null when absent. Do not inspect files or use tools to obtain this answer. Do not guess.';
const digest = (path: string) =>
  existsSync(path)
    ? createHash("sha256").update(readFileSync(path)).digest("hex")
    : null;
function policy() {
  const roots = [
    [
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      ["config.toml", "hooks.json", "rules"],
    ],
    [
      process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
      ["settings.json"],
    ],
    [
      process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"),
      ["settings.json"],
    ],
  ] as const;
  return roots.flatMap(([root, paths]) =>
    paths.flatMap((p) => {
      const path = join(root, p);
      return p === "rules" && existsSync(path)
        ? readdirSync(path)
            .sort()
            .map((n) => digest(join(path, n)))
        : [digest(path)];
    }),
  );
}
function latest(cwd: string): Run | undefined {
  const path = join(cwd, ".degreaser/state.json");
  if (!existsSync(path)) return undefined;
  const { latestRunId } = JSON.parse(readFileSync(path, "utf8"));
  return JSON.parse(
    readFileSync(join(cwd, ".degreaser/runs", latestRunId, "run.json"), "utf8"),
  );
}

export async function liveCaller(agent: Agent, model: string) {
  const cwd = await realpath(
    await mkdtemp(join(tmpdir(), "degreaser-caller-flow-")),
  );
  // Cursor's supported config/data overrides keep every Cursor write under
  // disposable state; login stays in the user's existing credential store.
  const cursorState =
    agent === "cursor"
      ? await realpath(await mkdtemp(join(tmpdir(), "degreaser-cursor-")))
      : undefined;
  const cursorEnvironment: Record<string, string> = cursorState
    ? {
        CURSOR_CONFIG_DIR: join(cursorState, "config"),
        CURSOR_DATA_DIR: join(cursorState, "data"),
      }
    : {};
  const previousEnvironment = Object.fromEntries(
    Object.keys(cursorEnvironment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, cursorEnvironment);
  const before = policy();
  const trace = new CallerEvidence(agent, model);
  const evidence: Record<string, unknown> = {
    agent,
    model,
    case: "caller",
    flow: trace,
    passed: false,
  };
  let watcher: NodeJS.Timeout | undefined;
  let violation: string | undefined;
  const sync = (cmd: string, args: string[]) =>
    spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 180_000 });
  try {
    assert.equal(sync("git", ["init", "--initial-branch=main"]).status, 0);
    await writeFile(
      join(cwd, ".gitignore"),
      `/.degreaser/\n.degreaserrc.json\n.agents/\n.codex/\n.claude/\n.pi/\n${agent === "cursor" ? ".cursor/\n" : ""}continuation.txt\n`,
    );
    await writeFile(
      join(cwd, "source.ts"),
      "export const sum = (a: number, b: number) => a + b;\n",
    );
    assert.equal(sync("git", ["add", "."]).status, 0);
    assert.equal(
      sync("git", ["commit", "-m", "Synthetic caller baseline"]).status,
      0,
    );
    const init = sync(process.execPath, [
      cli,
      "init",
      "--agent",
      agent,
      "--model",
      model,
      "--harnesses",
      agent,
    ]);
    assert.equal(init.status, 0, init.stdout);
    await writeFile(
      join(cwd, "source.ts"),
      "// Return the sum of two numbers.\nexport const sum = (a: number, b: number) => a + b;\n",
    );
    const source = digest(join(cwd, "source.ts")),
      index = digest(join(cwd, ".git/index"));
    let samples = 0;
    const check = () => {
      if (
        digest(join(cwd, "source.ts")) !== source ||
        digest(join(cwd, ".git/index")) !== index
      )
        violation = "Source or index changed";
      const state = latest(cwd);
      if (state?.status === "running") {
        samples++;
        if (existsSync(join(cwd, "continuation.txt")))
          violation = "Continuation occurred while running";
      }
    };
    watcher = setInterval(() => {
      try {
        check();
      } catch {
        violation = "Independent file observation failed";
      }
    }, 25);
    const emptyContext = new CallerEvidence(agent, model);
    evidence.noHistoryContext = emptyContext;
    evidence.noHistoryNative = await nativeCaller(
      agent,
      model,
      cwd,
      `${contextQuestion} Do not invoke any tools afterward. Also name the available Degreaser skill.`,
      emptyContext,
      check,
      "context",
      cursorEnvironment,
    );
    assert.deepEqual(
      policy(),
      before,
      "Global policy changed; stop before another caller",
    );
    assert.equal(
      emptyContext.events.length,
      0,
      "No-history startup answer must not use tools",
    );
    assert.equal(
      emptyContext.context.noHistory,
      true,
      "No-history context did not reach caller",
    );
    assert.equal(emptyContext.context.modelReceived, true);
    const nonce = randomUUID();
    const prompt = `This is an authorized synthetic Degreaser acceptance task in a disposable project.
Discover and read the installed degreaser skill, then follow it. Do not do your own review.
The installed unpublished CLI command is ${command}.
Run exactly one review: ${command} review --scope worktree --task 'Add a source-level sum helper; review the synthetic comment only' --aspects low-value-comments --wait 1
${agent === "codex" ? "For this exercise use yield_time_ms=1 on the review command." : agent === "claude" ? "For this exercise use Bash with timeout=61000 and run_in_background=true on the review command." : agent === "cursor" ? "Keep each Degreaser command in the foreground until that process exits. Do not set a command timeout. If a command is backgrounded, wait for its completion notification and do not start another review." : "Use normal bash with no timeout argument."}
Use the installed skill's waiting instructions. Keep this task active through the result.
Do not edit source or Git index. Only AFTER a terminal result is visible to you, perform this separately authorized continuation: write exactly '${nonce}' to continuation.txt with no newline. Do not change anything else or configure permissions. Finish with the observed run status.`;
    evidence.native = await nativeCaller(
      agent,
      model,
      cwd,
      prompt,
      trace,
      check,
      "review",
      cursorEnvironment,
    );
    assert.deepEqual(
      policy(),
      before,
      "Global policy changed; stop before another caller",
    );
    check();
    assert.equal(violation, undefined);
    assert.ok(samples > 0, "Independent observer must see genuine running");
    const run = latest(cwd);
    assert.ok(run);
    evidence.run = {
      id: run.id,
      status: run.status,
      workerSessions: run.tasks.flatMap((t) =>
        t.attempts.map((a) => a.sessionId),
      ),
      assignments: run.tasks.map((t) => t.assignment),
    };
    evidence.unchangedRunningSamples = samples;
    assert.ok(
      trace.events.some((e) => e.kind === "result" && e.skillLoaded),
      "Caller did not load skill",
    );
    assert.equal(
      trace.events.filter((e) => e.kind === "call" && e.operation === "review")
        .length,
      1,
    );
    const running = trace.events.findIndex(
      (e) =>
        e.kind === "result" &&
        e.status === "running" &&
        e.exit === 3 &&
        e.run === run.id,
    );
    assert.ok(running >= 0, "No genuine native running result");
    const waited = trace.events.findIndex(
      (e, i) =>
        i > running &&
        e.kind === "call" &&
        e.operation === "wait" &&
        e.run === run.id,
    );
    assert.ok(waited > running, "Caller did not wait on same run");
    const terminal = trace.events.findIndex(
      (e, i) =>
        i > waited &&
        e.kind === "result" &&
        (e.operation === "wait" || e.operation === "poll") &&
        e.run === run.id &&
        ["completed", "partial", "failed"].includes(e.status ?? ""),
    );
    assert.ok(terminal > waited, "No native terminal result after wait");
    const continuation = trace.events.findIndex(
      (e) => e.kind === "call" && e.operation === "continue",
    );
    assert.ok(
      continuation > terminal,
      "Caller continued before terminal evidence",
    );
    if (agent !== "pi" && agent !== "cursor")
      assert.ok(
        trace.events.some((e) => e.kind === "result" && e.yielded),
        "No tracked native tool yield",
      );
    if (agent !== "pi" && agent !== "cursor") {
      const yielded = trace.events.find(
        (e) =>
          e.kind === "result" &&
          e.operation === "review" &&
          e.yielded &&
          e.handle,
      );
      assert.ok(
        yielded &&
          trace.events.some(
            (e) => e.kind === "call" && e.handle === yielded.handle,
          ),
        "Caller did not continue yielded session",
      );
    }
    assert.equal(run.status, "completed");
    assert.equal(
      readdirSync(join(cwd, ".degreaser/runs")).length,
      1,
      "Replacement review created",
    );
    assert.equal(readFileSync(join(cwd, "continuation.txt"), "utf8"), nonce);
    const context = new CallerEvidence(agent, model, run.id);
    evidence.knownContext = context;
    const contextPrompt = `${contextQuestion} Do not invoke any tools afterward. Also name the available Degreaser skill.`;
    assert.ok(!contextPrompt.includes(run.id), "Canary leaked into prompt");
    evidence.knownNative = await nativeCaller(
      agent,
      model,
      cwd,
      contextPrompt,
      context,
      check,
      "context",
      cursorEnvironment,
    );
    check();
    assert.equal(violation, undefined);
    assert.equal(
      context.context.canaryReceived,
      true,
      "Context-only run canary was not received",
    );
    assert.equal(context.context.modelReceived, true);
    assert.equal(context.context.completed, true);
    assert.equal(
      context.events.length,
      0,
      "Known-run context was obtained with tools instead of startup",
    );
    evidence.passed = true;
  } finally {
    if (watcher) clearInterval(watcher);
    let run = latest(cwd);
    const until = Date.now() + 15_000;
    while (run?.owner && ownerAlive(run.owner) && Date.now() < until) {
      if (run.status === "running")
        sync(process.execPath, [cli, "cancel", run.id]);
      await setTimeout(100);
      run = latest(cwd);
    }
    const joined = !run?.owner || !ownerAlive(run.owner);
    if (agent === "cursor") stopCursorAt(cwd);
    evidence.ownerJoined = joined;
    for (const [key, value] of Object.entries(previousEnvironment))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    if (cursorState) await rm(cursorState, { recursive: true, force: true });
    evidence.globalPolicyUnchanged =
      JSON.stringify(policy()) === JSON.stringify(before);
    evidence.passed =
      evidence.passed === true &&
      joined &&
      evidence.globalPolicyUnchanged === true;
    console.log(JSON.stringify(evidence, null, 2));
    if (joined) await rm(cwd, { recursive: true, force: true });
    else
      console.error(
        `Owner cleanup unconfirmed; disposable fixture retained at ${cwd}`,
      );
    assert.equal(joined, true, "Owned run did not stop");
    assert.equal(
      evidence.globalPolicyUnchanged,
      true,
      "Global policy changed; stop and report",
    );
  }
}
