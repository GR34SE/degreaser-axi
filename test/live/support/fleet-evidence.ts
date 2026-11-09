import assert from "node:assert/strict";
import { ASPECT_IDS } from "../../../src/modules/aspect/api.ts";
import type { Run } from "../../../src/state/run.ts";

export interface FleetEvent {
  type: "start" | "session" | "prompt" | "spawn" | "exit" | "outcome" | "end";
  time: number;
  aspect: string;
  agent: string;
  model: string;
  sessionId?: string;
  pid?: number;
  adapterVersion?: string;
  nativeVersion?: string;
}

export function fleetEvidence(
  run: Run,
  events: FleetEvent[],
  agent: string,
  model: string,
) {
  assert.equal(run.status, "completed", "Fleet must be completed");
  assert.equal(
    run.executions?.length,
    1,
    "Resumed fleets are not initial acceptance",
  );
  assert.equal(run.executions[0]?.concurrency, null, "Fleet must be uncapped");
  const aspects = [...ASPECT_IDS];
  const [first] = aspects;
  assert.deepEqual(
    run.tasks.map((t) => t.assignment.aspect),
    aspects,
  );
  assert.ok(
    run.tasks.every(
      (t) => t.assignment.agent === agent && t.assignment.model === model,
    ),
    "Exact identity required",
  );
  assert.ok(
    events.every((e) => e.agent === agent && e.model === model),
    "Observed identity differs",
  );
  const firstPrompt = events.findIndex((e) => e.type === "prompt");
  assert.ok(
    firstPrompt >= 0 && events[firstPrompt]?.aspect === first,
    "Missing first-worker warmup",
  );
  assert.deepEqual(
    events
      .slice(0, firstPrompt)
      .filter((e) => e.type === "start")
      .map((e) => e.aspect),
    [first],
    "Cold admission before warmup",
  );
  const sessions = new Set<string>();
  for (const task of run.tasks) {
    const aspect = task.assignment.aspect;
    assert.ok(
      ["findings", "no-findings", "not-applicable"].includes(task.status) &&
        task.result,
      `Unresolved ${aspect}`,
    );
    assert.ok(
      task.attempts.length >= 1 && task.attempts.length <= 2,
      `Unbounded retry: ${aspect}`,
    );
    assert.equal(
      task.attempts.at(-1)?.failure,
      null,
      `Final attempt failed: ${aspect}`,
    );
    const own = events.filter((e) => e.aspect === aspect);
    for (const type of ["start", "session", "prompt", "end"])
      assert.equal(
        own.filter((e) => e.type === type).length,
        task.attempts.length,
        `Missing/duplicate ${type}: ${aspect}`,
      );
    const sessionEvents = own.filter((e) => e.type === "session");
    for (const [i, attempt] of task.attempts.entries()) {
      assert.ok(attempt.sessionId && attempt.endedAt);
      assert.equal(sessionEvents[i]?.sessionId, attempt.sessionId);
      sessions.add(attempt.sessionId);
      if (i < task.attempts.length - 1)
        assert.ok(
          ["invalid-output", "output-limit", "timeout"].includes(
            attempt.failure ?? "",
          ),
          "Unexpected automatic retry cause",
        );
    }
    if (aspect !== first)
      assert.ok(
        (task.attempts[0]?.startedAt ?? 0) >=
          (events[firstPrompt]?.time ?? Infinity),
        "Queue admitted before warmup",
      );
  }
  assert.equal(
    sessions.size,
    run.tasks.reduce((n, t) => n + t.attempts.length, 0),
    "Sessions must be fresh",
  );
  const rest = run.tasks.slice(1).map((t) => t.attempts[0]);
  assert.ok(
    Math.max(...rest.map((a) => a?.startedAt ?? Infinity)) <=
      Math.min(...rest.map((a) => a?.endedAt ?? 0)),
    "Serialized or capped admission",
  );
  let active = 0,
    peakInvocations = 0;
  const invoked = new Set<string>();
  for (const event of events) {
    if (event.type === "prompt") {
      invoked.add(event.aspect);
      peakInvocations = Math.max(peakInvocations, ++active);
    } else if (event.type === "end" && invoked.delete(event.aspect)) active--;
  }
  assert.ok(peakInvocations > 1, "No actual invocation overlap");
  assert.equal(active, 0, "Invocations not joined");
  return { sessions: sessions.size, warmup: true, peakInvocations };
}
