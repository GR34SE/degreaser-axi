import assert from "node:assert/strict";
import type { Agent } from "../../../src/modules/harness/api.ts";
import type { Run } from "../../../src/state/run.ts";
import type { CallerEvidence } from "./caller-evidence.ts";

export function assertCallerFlow(
  agent: Agent,
  trace: CallerEvidence,
  run: Run,
) {
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
}
