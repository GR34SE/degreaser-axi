import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { processCommands, processCpu, processTable } from "./process-table.ts";

test("process projections describe the same live child by identity, CPU and command", async (t) => {
  const marker = `degreaser-process-table-${process.pid}`;
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", marker],
    { stdio: "ignore" },
  );
  t.after(() => child.kill("SIGKILL"));
  await once(child, "spawn");
  const pid = child.pid;
  assert.ok(pid);

  const identity = processTable().find((row) => row.pid === pid);
  assert.ok(identity);
  assert.equal(identity.parent, process.pid);
  assert.match(identity.started, /^\S+ \S+ \d+ \S+ \d+$/);
  assert.deepEqual(Object.keys(identity).sort(), [
    "group",
    "parent",
    "pid",
    "started",
  ]);

  const measured = processCpu({ timeout: 5000 }).find((row) => row.pid === pid);
  assert.ok(measured);
  assert.deepEqual({ ...measured, cpu: 0 }, { ...identity, cpu: 0 });
  assert.ok(Number.isFinite(measured.cpu) && measured.cpu >= 0);

  const commands = processCommands({ timeout: 3000 });
  assert.equal(
    commands.find((row) => row.pid === pid)?.command.endsWith(marker),
    true,
  );
  // Each read excludes its own ps probe, which is never a caller's process.
  assert.equal(
    commands.some((row) => /^\S*\/?ps -ww -axo /.test(row.command)),
    false,
  );

  child.kill("SIGKILL");
  await once(child, "exit");
});
