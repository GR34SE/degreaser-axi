import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { workerEnvironment } from "../../modules/harness/common/isolation.ts";
import type { NativeProfile } from "../../modules/harness/common/profile.ts";

const fixture = fileURLToPath(
  new URL("../../../test/fixtures/synthetic-acp.mjs", import.meta.url),
);
async function setup(scenario: string) {
  const cwd = await mkdtemp(join(tmpdir(), "degreaser-runtime-"));
  const log = join(cwd, "events.jsonl");
  const profile: NativeProfile = {
    agent: scenario === "pi" ? "pi" : "claude",
    model: scenario === "pi" ? "openai/exact" : "exact",
    command: [process.execPath, fixture, scenario, log],
    environment: workerEnvironment(process.env),
    adapterVersion: "synthetic",
    nativeVersion: "synthetic",
    limitations: [],
  };
  return {
    cwd,
    profile,
    events: async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s)),
  };
}

test("real acpx boundary verifies exact model before prompting and joins each fresh attempt", async () => {
  const { executeWorker } = await import("./session.ts");
  const f = await setup("success");
  const grant = process.env.ACPX_AUTH_OPENAI_API_KEY;
  process.env.ACPX_AUTH_OPENAI_API_KEY = "synthetic-secret";
  try {
    const pids = new Set<number>();
    for (let i = 0; i < 2; i++) {
      const result = await executeWorker(
        {
          cwd: f.cwd,
          prompt: "Synthetic source review",
          maxTurns: 2,
          timeoutMs: 10_000,
          onLifecycle: (event) => {
            if (event.type === "spawn") pids.add(event.pid);
            else pids.delete(event.pid);
          },
        },
        f.profile,
      );
      assert.equal(
        result.status,
        "completed",
        JSON.stringify({ result, events: await f.events() }),
      );
      assert.equal(result.model, "exact");
      assert.match(result.output, /<degreaser-result>/);
      assert.ok(!JSON.stringify(result).includes("private synthetic thought"));
      assert.equal(pids.size, 0);
    }
    const events = await f.events();
    assert.equal(
      new Set(events.filter((e) => e.method === "new").map((e) => e.sessionId))
        .size,
      2,
    );
    assert.equal(events.filter((e) => e.method === "prompt").length, 2);
    assert.ok(
      events
        .filter((e) => e.method === "prompt")
        .every((e) => e.model === "exact"),
    );
    for (const event of events.filter((e) => e.method === "initialize")) {
      assert.equal(event.marker, "1");
      assert.deepEqual(event.leaked, []);
      assert.ok(!event.terminal && !event.fs?.writeTextFile);
    }
  } finally {
    if (grant === undefined) delete process.env.ACPX_AUTH_OPENAI_API_KEY;
    else process.env.ACPX_AUTH_OPENAI_API_KEY = grant;
    await rm(f.cwd, { recursive: true, force: true });
  }
});

for (const [scenario, failure] of [
  ["mismatch", "model-unavailable"],
  ["startup-hang", "timeout"],
  ["rate-limit", "rate-limited"],
] as const) {
  test(`synthetic ${scenario} fails closed without fallback or raw diagnostics`, async () => {
    const { executeWorker } = await import("./session.ts");
    const f = await setup(scenario);
    try {
      const result = await executeWorker(
        {
          cwd: f.cwd,
          prompt: "Synthetic source review",
          maxTurns: 2,
          timeoutMs: 1500,
        },
        f.profile,
      );
      assert.equal(result.status, "failed");
      assert.equal(result.failure, failure);
      assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
      const events = await f.events();
      assert.equal(
        events.filter((e) => e.method === "prompt").length,
        scenario === "rate-limit" ? 1 : 0,
      );
      if (scenario === "mismatch")
        assert.ok(events.some((e) => e.method === "setModel"));
    } finally {
      await rm(f.cwd, { recursive: true, force: true });
    }
  });
}

test("pre-cancelled attempts launch nothing and active cancellation joins work", async () => {
  const { executeWorker } = await import("./session.ts");
  const f = await setup("hang");
  try {
    const cancelled = new AbortController();
    cancelled.abort();
    let launches = 0;
    const request = {
      cwd: f.cwd,
      prompt: "Synthetic cancellation",
      maxTurns: 2,
      timeoutMs: 10_000,
      onLifecycle(event: { type: "spawn" | "exit"; pid: number }) {
        if (event.type === "spawn") launches++;
      },
    };
    const early = await executeWorker(
      { ...request, signal: cancelled.signal },
      f.profile,
    );
    assert.equal(early.failure, "cancelled");
    assert.equal(launches, 0);
    const active = new AbortController();
    const result = await executeWorker(
      {
        ...request,
        signal: active.signal,
        onPromptStarted() {
          active.abort();
        },
      },
      f.profile,
    );
    assert.equal(result.failure, "cancelled");
    assert.equal(launches, 1);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("unadvertised models are rejected before any prompt; no default fallback", async () => {
  const { executeWorker } = await import("./session.ts");
  const f = await setup("success");
  try {
    const result = await executeWorker(
      {
        cwd: f.cwd,
        prompt: "Must not dispatch",
        maxTurns: 2,
        timeoutMs: 10_000,
      },
      { ...f.profile, model: "absent" },
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failure, "model-unavailable");
    assert.ok(!(await f.events()).some((e) => e.method === "prompt"));
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("Pi never invokes persistent model RPC and retains output across unsupported close", async () => {
  const { executeWorker } = await import("./session.ts");
  const f = await setup("pi");
  try {
    const result = await executeWorker(
      {
        cwd: f.cwd,
        prompt: "Synthetic review",
        maxTurns: 2,
        timeoutMs: 10_000,
      },
      f.profile,
    );
    assert.equal(result.status, "completed");
    assert.match(result.output, /no-findings/);
    assert.ok(!(await f.events()).some((e) => e.method === "setModel"));
    assert.ok(
      result.limitations.includes(
        "Adapter session close is unsupported; owned processes were shut down and joined.",
      ),
    );
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("attempt timeout covers inference and cleanup joins a stubborn descendant", async () => {
  const { executeWorker } = await import("./session.ts");
  const f = await setup("hang");
  try {
    const result = await executeWorker(
      { cwd: f.cwd, prompt: "Synthetic hang", maxTurns: 2, timeoutMs: 2000 },
      f.profile,
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failure, "timeout");
    const child = (await f.events()).find((e) => e.method === "child");
    assert.ok(child);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("streamed output crossing the limit is discarded and the real runtime is joined", async () => {
  const { executeWorker } = await import("./session.ts");
  const f = await setup("output-limit");
  const pids = new Set<number>();
  try {
    const result = await executeWorker(
      {
        cwd: f.cwd,
        prompt: "Synthetic excessive output",
        maxTurns: 2,
        timeoutMs: 10_000,
        onLifecycle(event) {
          if (event.type === "spawn") pids.add(event.pid);
          else pids.delete(event.pid);
        },
      },
      f.profile,
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failure, "output-limit");
    assert.equal(result.output, "");
    assert.equal(result.cleanupFailed, false);
    assert.match(
      result.limitations.join(" "),
      /1,048,576 characters.*discarded/,
    );
    const events = await f.events();
    assert.equal(events.filter((e) => e.method === "prompt").length, 1);
    assert.ok(events.some((e) => e.method === "cancel"));
    assert.equal(pids.size, 0);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("the shared worker instruction travels once: as Claude's system prompt, else in the turn text", async () => {
  const { executeWorker } = await import("./session.ts");
  const { workerInstruction } = await import("./prompt/assemble.ts");
  const instruction = workerInstruction(2);
  const prompt = `${instruction}\n\nAssigned aspect: scope-creep`;
  for (const scenario of ["success", "pi"]) {
    const f = await setup(scenario);
    const result = await executeWorker(
      { cwd: f.cwd, prompt, maxTurns: 2, timeoutMs: 10_000 },
      f.profile,
    );
    assert.equal(result.status, "completed", JSON.stringify(result));
    const events = await f.events();
    const system = events.find((e) => e.method === "new").system;
    const text = events.find((e) => e.method === "prompt").text;
    if (scenario === "success") {
      assert.equal(system, instruction);
      assert.equal(text, "Assigned aspect: scope-creep");
    } else {
      assert.equal(system, null);
      assert.equal(text, prompt);
    }
  }
});

for (const [scenario, stage, failure, recovery, stopReason] of [
  ["session-fail", "session-setup", "runtime", "inspect", undefined],
  ["startup-hang", "session-setup", "timeout", "resume", undefined],
  ["mismatch", "model-check", "model-unavailable", "change-model", undefined],
  ["rate-limit", "turn-result", "rate-limited", "wait-for-quota", undefined],
  ["output-limit", "turn-stream", "output-limit", "resume", "cancelled"],
  ["refusal", "turn-result", undefined, undefined, "refusal"],
] as const) {
  test(`synthetic ${scenario} keeps its lifecycle stage and no sensitive text`, async () => {
    const { executeWorker } = await import("./session.ts");
    const f = await setup(scenario);
    try {
      const result = await executeWorker(
        {
          cwd: f.cwd,
          prompt: "Synthetic source review",
          maxTurns: 2,
          timeoutMs: scenario === "startup-hang" ? 1500 : 10_000,
        },
        f.profile,
      );
      assert.equal(result.failure, failure);
      assert.equal(result.stopReason, stopReason);
      if (failure) {
        assert.equal(result.diagnostic?.stage, stage);
        assert.equal(result.diagnostic?.recovery, recovery);
      } else assert.equal(result.diagnostic, undefined);
      const saved = JSON.stringify(result.diagnostic ?? {});
      assert.ok(!saved.includes("synthetic-secret"));
      assert.ok(!/Synthetic (?:setup|rate)/.test(saved));
    } finally {
      await rm(f.cwd, { recursive: true, force: true });
    }
  });
}
