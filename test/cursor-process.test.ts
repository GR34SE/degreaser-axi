import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stopCursorAt } from "../scripts/cursor-process.ts";
import { workerEnvironment } from "../src/native-environment.ts";

function idle(cwd: string): ChildProcess {
  return spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", "cursor-agent"],
    { cwd, stdio: "ignore" },
  );
}

const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) =>
    child.exitCode !== null || child.signalCode !== null
      ? resolve()
      : child.once("exit", () => resolve()),
  );

test("Cursor cleanup stops only processes inside the exact owned directory", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "degreaser-stop-")));
  const owned = join(root, "repo");
  const nested = join(owned, "nested");
  const colliding = join(root, "repo-other");
  for (const dir of [nested, colliding]) mkdirSync(dir, { recursive: true });
  const [a, b, c] = [idle(owned), idle(nested), idle(colliding)] as [
    ChildProcess,
    ChildProcess,
    ChildProcess,
  ];
  const children = [a, b, c];
  t.after(() => {
    for (const child of children) child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  stopCursorAt(owned);
  await Promise.all([exited(a), exited(b)]);
  assert.equal(a.signalCode, "SIGKILL");
  assert.equal(b.signalCode, "SIGKILL");
  assert.equal(c.exitCode, null);
  assert.equal(c.signalCode, null);
});

test("review workers do not inherit Cursor state redirects", () => {
  const env = workerEnvironment({
    PATH: "/bin",
    CURSOR_CONFIG_DIR: "/tmp/a",
    CURSOR_DATA_DIR: "/tmp/b",
  });
  assert.deepEqual(env, { PATH: "/bin", DEGREASER_WORKER: "1" });
});
