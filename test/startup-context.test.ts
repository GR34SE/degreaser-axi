import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./git-fixture.ts";
import { queueFixture } from "./queue-fixture.ts";

const entry = new URL("../bin/startup-context.ts", import.meta.url).pathname;
const cli = new URL("../dist/bin/degreaser-axi.js", import.meta.url).pathname;

function hook(
  cwd: string,
  options: { input?: string; plain?: boolean; worker?: string } = {},
) {
  const result = spawnSync(
    process.execPath,
    [entry, ...(options.plain ? ["--plain"] : [])],
    {
      cwd,
      input: options.input ?? "",
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, DEGREASER_WORKER: options.worker ?? "" },
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.length <= 1500);
  return result.stdout;
}

test("native JSON cwd and plain mode discover project configuration", (t) => {
  const f = fixture(t);
  const other = fixture(t);
  other.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "claude", model: "different-model" }),
  );
  mkdirSync(join(f.root, "nested"));
  const output = hook(other.root, {
    input: JSON.stringify({ cwd: join(f.root, "nested") }),
  });
  const context = JSON.parse(output).hookSpecificOutput;
  assert.equal(context.hookEventName, "SessionStart");
  assert.match(context.additionalContext, /codex.*gpt-6-luna/i);
  assert.match(
    hook(join(f.root, "nested"), { plain: true }),
    /codex.*gpt-6-luna/i,
  );
});

test("Cursor sessionStart reads workspace_roots and uses additional_context", (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [entry, "--cursor"], {
    cwd: tmpdir(),
    input: JSON.stringify({
      session_id: "s1",
      is_background_agent: false,
      workspace_roots: [f.root],
    }),
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, DEGREASER_WORKER: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hookSpecificOutput, undefined);
  assert.match(payload.additional_context, /codex.*gpt-6-luna/i);
});

test("repositories without a Degreaser config stay silent", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, ".degreaserrc.json"));
  assert.equal(hook(f.root), "");
});

test("worker and corrupt history are silent; an invalid config gets one doctor line", (t) => {
  const f = fixture(t);
  assert.equal(hook(f.root, { worker: "1" }), "");
  writeFileSync(join(f.root, ".degreaserrc.json"), "{");
  assert.match(
    JSON.parse(hook(f.root)).hookSpecificOutput.additionalContext,
    /^Degreaser config invalid; run degreaser-axi doctor$/,
  );
  assert.equal(hook(f.root, { worker: "1" }), "");
  f.write(
    ".degreaserrc.json",
    JSON.stringify({ agent: "codex", model: "gpt-6-luna" }),
  );
  f.write(".degreaser/state.json", "{");
  assert.equal(hook(f.root), "");
});

test("reports a real synthetic review and suggests report or wait", async (t) => {
  const f = queueFixture(t);
  f.setPlan({ worker: { resultGate: f.gate("result") } });
  assert.equal(f.start(["--aspects", "missed-reuse"]).status, 3);
  const running = f.state();
  const before = hook(f.root, { plain: true });
  assert.match(before, new RegExp(`wait ${running.id}`));
  f.release("result");
  assert.equal(f.finish().status, 0);
  const run = f.state();
  const text = hook(f.root, { plain: true });
  assert.match(text, new RegExp(run.id));
  assert.match(text, new RegExp(run.status));
  assert.match(text, /degreaser-axi report/);
});

test("open stdin without input cannot hang a session", async (t) => {
  const f = fixture(t);
  const child = spawn(process.execPath, [entry], {
    cwd: f.root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const timer = setTimeout(() => child.kill(), 3000);
  const [code] = await once(child, "exit");
  clearTimeout(timer);
  assert.equal(code, 0);
});

test("sparse RC notice points to config sync without rewriting and disappears after it", (t) => {
  const f = fixture(t);
  const path = join(f.root, ".degreaserrc.json");
  const before = readFileSync(path);
  const sparse = hook(f.root, { plain: true });
  assert.match(sparse, /installed defaults; degreaser-axi config sync/);
  assert.deepEqual(readFileSync(path), before);
  const sync = spawnSync(process.execPath, [cli, "config", "sync"], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, DEGREASER_WORKER: "" },
  });
  assert.equal(sync.status, 0, sync.stderr);
  const synced = hook(f.root, { plain: true });
  assert.doesNotMatch(synced, /config sync|Missing settings/);
  assert.match(synced, /codex\/gpt-6-luna/);
});
