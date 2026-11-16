import assert from "node:assert/strict";
import { test } from "node:test";
import gitGate from "./git-gate.ts";

test("Pi gate blocks bash calls other than read-only git and leaves other tools alone", () => {
  const handlers: Parameters<Parameters<typeof gitGate>[0]["on"]>[1][] = [];
  gitGate({ on: (_event, handler) => handlers.push(handler) });
  assert.equal(handlers.length, 1);
  const [handler] = handlers;
  assert.ok(handler);
  const call = (toolName: string, command: unknown) =>
    handler({ toolName, input: { command } });
  assert.equal(call("bash", "git diff --stat HEAD"), undefined);
  assert.equal(call("read", "rm -rf src"), undefined);
  for (const command of ["rm -rf src", "git diff > x", "git push", undefined])
    assert.equal(call("bash", command)?.block, true, String(command));
});
