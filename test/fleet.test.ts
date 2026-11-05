import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { type FleetEvent, fleetEvidence } from "../scripts/fleet-evidence.ts";
import {
  fleetLock,
  liveProcessIds,
  monitorFleet,
  parseMemory,
  selectedQuota,
  unsafeMemory,
} from "../scripts/fleet-resources.ts";
import { queueFixture, until } from "./queue-fixture.ts";

for (const retry of [false, true]) {
  test(`fleet observation preserves default admission and bounded retry=${retry}`, async (t) => {
    const f = queueFixture(t, { maxRetries: 1 });
    const trace = f.gate("trace.jsonl");
    const observer = fileURLToPath(
      new URL("../scripts/fleet-observer.mjs", import.meta.url),
    );
    f.setPlan({
      worker: { resultGate: f.gate("results") },
      ...(retry
        ? {
            workers: {
              A06: {
                attempts: [
                  {
                    resultGate: f.gate("results"),
                    result: "invalid synthetic output",
                  },
                  {},
                ],
              },
            },
          }
        : {}),
    });
    const child = f.launch(
      [
        "review",
        "--scope",
        "worktree",
        "--task",
        "Update source",
        "--wait",
        "1",
      ],
      { imports: [observer], env: { DEGREASER_FLEET_TRACE: trace } },
    );
    child.stdout.resume();
    child.stderr.resume();
    assert.equal((await once(child, "exit"))[0], 3);
    await until(
      () => f.events().length === 16,
      "All synthetic adapters received prompts",
    );
    f.release("results");
    assert.equal(f.finish().status, 0);
    const events: FleetEvent[] = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const run = f.state();
    const evidence = fleetEvidence(run, events, "codex", "gpt-6-luna");
    assert.equal(evidence.sessions, retry ? 17 : 16);
    assert.equal(evidence.peakInvocations, 16);
    assert.equal(evidence.warmup, true);
    assert.deepEqual(
      events
        .filter((e) => e.type === "session")
        .map((e) => e.sessionId)
        .sort(),
      run.tasks
        .flatMap((task) => task.attempts.map((attempt) => attempt.sessionId))
        .sort(),
    );
    const capped = structuredClone(run);
    assert.ok(capped.executions?.[0]);
    capped.executions[0].concurrency = 2;
    assert.throws(
      () => fleetEvidence(capped, events, "codex", "gpt-6-luna"),
      /uncapped/,
    );
    const partial = structuredClone(run);
    partial.status = "partial";
    assert.throws(
      () => fleetEvidence(partial, events, "codex", "gpt-6-luna"),
      /completed/,
    );
    const resumed = structuredClone(run);
    assert.ok(resumed.executions?.[0]);
    resumed.executions.push({ ...resumed.executions[0] });
    assert.throws(
      () => fleetEvidence(resumed, events, "codex", "gpt-6-luna"),
      /Resumed/,
    );
    const cold = structuredClone(events);
    const first = cold.findIndex((e) => e.type === "prompt");
    cold.splice(first, 1);
    assert.throws(
      () => fleetEvidence(run, cold, "codex", "gpt-6-luna"),
      /warmup/,
    );
    assert.throws(
      () => fleetEvidence(run, events, "claude", "claude-haiku-4-5-20251001"),
      /identity/,
    );
  });
}

test("host memory uses physical page headroom, not summed shared RSS", () => {
  const memory = parseMemory(
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\nPages inactive: 200.\nPages speculative: 50.\nPages occupied by compressor: 30.\n",
    "1",
    "total = 1024.00M used = 147.00M free = 877.00M (encrypted)",
  );
  assert.equal(memory.headroomBytes, 350 * 16384);
  assert.equal(memory.compressorBytes, 30 * 16384);
  assert.equal(memory.swapBytes, 147 * 1024 ** 2);
  assert.equal(unsafeMemory(memory, memory), false);
  assert.equal(
    unsafeMemory(memory, {
      ...memory,
      headroomBytes: memory.headroomBytes * 0.29,
    }),
    true,
  );
  assert.equal(unsafeMemory(memory, { ...memory, pressure: 2 }), true);
  assert.throws(
    () => parseMemory("unavailable", "1", "unavailable"),
    /measurement/,
  );
});

test("monitor failure before admission still cancels a subsequently admitted owner", async () => {
  const stop = new AbortController();
  let failed = false,
    ticks = 0,
    joined = false;
  await monitorFleet(
    {
      sample() {
        throw new Error("measurement unavailable");
      },
      stopRequested: () => failed,
      onFailure() {
        failed = true;
      },
      async cancel() {
        ticks++;
        if (ticks === 1) return; // Metadata admission has not created state yet.
        if (ticks === 2) throw new Error("temporary cancellation failure");
        joined = true;
        stop.abort();
      },
    },
    stop.signal,
    1,
  );
  assert.equal(failed, true);
  assert.equal(joined, true);
  assert.equal(ticks, 3);
});

test("resource sampling continues during cancellation and joins the pending attempt", async () => {
  const stop = new AbortController();
  let samples = 0,
    cancellations = 0;
  let complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const watchdog = setTimeout(() => {
    complete();
    stop.abort();
  }, 1000);
  try {
    await monitorFleet(
      {
        sample() {
          samples++;
          if (samples === 3) {
            complete();
            stop.abort();
          }
        },
        stopRequested: () => true,
        cancel() {
          cancellations++;
          return pending;
        },
        onFailure: () => assert.fail("Unexpected monitor failure"),
      },
      stop.signal,
      1,
    );
    assert.equal(samples, 3);
    assert.equal(cancellations, 1);
  } finally {
    clearTimeout(watchdog);
  }
});

test("fleet admission excludes another pilot and preserves an existing lock", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "degreaser-fleet-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "active.lock");
  const release = fleetLock(path);
  const bytes = readFileSync(path, "utf8");
  assert.throws(() => fleetLock(path), /EEXIST/);
  assert.equal(readFileSync(path, "utf8"), bytes);
  release();
  fleetLock(path)();
  assert.deepEqual(
    liveProcessIds(
      "10 node scripts/test-live.ts --run --case fleet\n11 node /repo/scripts/live-review.ts\n12 node /repo/dist/bin/run-owner.js\n13 node unrelated.js\n14 node scripts/test-live.ts",
      14,
    ),
    [10, 11, 12],
  );
});

test("selected quota ignores unrelated exhausted model pools but not shared exhaustion", () => {
  const entries = [
    { scope: "all_models", status: "known", effectivePercentRemaining: 35 },
    { scope: "model:fable", status: "known", effectivePercentRemaining: 0 },
  ];
  assert.equal(selectedQuota(entries, "claude-haiku-4-5-20251001"), 35);
  assert.throws(
    () =>
      selectedQuota(
        [{ ...entries[0], effectivePercentRemaining: 0 }],
        "claude-haiku-4-5-20251001",
      ),
    /Quota unavailable/,
  );
  assert.throws(
    () =>
      selectedQuota(
        [
          ...entries,
          {
            scope: "model:haiku",
            status: "known",
            effectivePercentRemaining: 0,
          },
        ],
        "claude-haiku-4-5-20251001",
      ),
    /Quota unavailable/,
  );
  assert.throws(() => selectedQuota([], "gpt-6-luna"), /Quota unavailable/);
});
