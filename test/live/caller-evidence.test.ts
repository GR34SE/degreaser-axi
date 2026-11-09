import assert from "node:assert/strict";

import { test } from "node:test";

import { CallerEvidence } from "./support/caller-evidence.ts";

test("assistant claims cannot substitute for native running and terminal results", () => {
  const trace = new CallerEvidence("pi", "model", "r-20261105-1200-abcd");
  trace.record({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: 'STARTUP {"history":"known","model":"model","run":"r-20261105-1200-abcd","status":"completed"}',
        },
      ],
    },
  });
  assert.equal(trace.events.length, 0);
  assert.equal(trace.context.canaryReceived, true);
});

test("negated prose and unavailable context cannot prove startup delivery", () => {
  const trace = new CallerEvidence("pi", "model", "r-20261105-1200-abcd");
  for (const text of [
    "No local run history information was supplied. The run r-20261105-1200-abcd may not be completed.",
    'STARTUP {"history":"unavailable","model":null,"run":null,"status":null}',
  ])
    trace.record({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
  assert.deepEqual(trace.context, {
    noHistory: false,
    modelReceived: false,
    canaryReceived: false,
    completed: false,
  });
});

test("startup answers after a tool read do not prove ambient receipt", () => {
  const trace = new CallerEvidence("pi", "model");
  trace.record({
    type: "tool_execution_start",
    toolCallId: "read",
    toolName: "read",
    args: { path: ".degreaserrc.json" },
  });
  trace.record({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: 'STARTUP {"history":"none","model":"model","run":null,"status":null}',
        },
      ],
    },
  });
  assert.equal(trace.context.noHistory, false);
});

test("startup model receipt permits the emitted harness prefix but not another model", () => {
  const trace = new CallerEvidence("pi", "openai/gpt-6-luna");
  for (const [model, expected] of [
    ["pi/openai/gpt-6-luna", true],
    ["openai/gpt-6-luna", true],
    ["gpt-6-luna", false],
    ["pi/openai/other", false],
  ] as const) {
    trace.record({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `STARTUP ${JSON.stringify({ history: "none", model, run: null, status: null })}`,
          },
        ],
      },
    });
    assert.equal(trace.context.modelReceived, expected);
  }
});

test("Pi tool results retain running and same-run wait separately from commands", () => {
  const trace = new CallerEvidence("pi", "model");
  trace.record({
    type: "tool_execution_start",
    toolCallId: "a",
    toolName: "bash",
    args: { command: "degreaser-axi review --scope worktree --wait 1" },
  });
  trace.record({
    type: "tool_execution_end",
    toolCallId: "a",
    toolName: "bash",
    result: {
      content: [
        {
          type: "text",
          text: "run: r-20261105-1200-abcd\nstatus: running\nCommand exited with code 3",
        },
      ],
    },
  });
  trace.record({
    type: "tool_execution_start",
    toolCallId: "b",
    toolName: "bash",
    args: { command: "degreaser-axi wait r-20261105-1200-abcd --wait 60" },
  });
  trace.record({
    type: "tool_execution_end",
    toolCallId: "b",
    toolName: "bash",
    result: {
      content: [
        { type: "text", text: "run: r-20261105-1200-abcd\nstatus: completed" },
      ],
    },
  });
  assert.deepEqual(
    trace.events.map((e) => [e.kind, e.operation, e.status, e.run]),
    [
      ["call", "review", undefined, undefined],
      ["result", "review", "running", "r-20261105-1200-abcd"],
      ["call", "wait", undefined, "r-20261105-1200-abcd"],
      ["result", "wait", "completed", "r-20261105-1200-abcd"],
    ],
  );
  assert.equal(trace.events[1]?.exit, 3);
});

test("Claude tracked handles are not terminal evidence", () => {
  const trace = new CallerEvidence("claude", "model");
  trace.record({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "a",
          name: "Bash",
          input: {
            command: "degreaser-axi review --scope worktree --wait 1",
            timeout: 61000,
            run_in_background: true,
          },
        },
      ],
    },
  });
  trace.record({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "a",
          content:
            "Command running in background with ID: xyz. Output file: /tmp/output",
        },
      ],
    },
  });
  assert.equal(trace.events[1]?.yielded, true);
  assert.equal(trace.events[1]?.status, undefined);
  assert.equal(trace.events[0]?.timeout, 61000);
});

test("Codex raw command-session continuation preserves native handles", () => {
  const trace = new CallerEvidence("codex", "model");
  for (const item of [
    {
      type: "function_call",
      name: "exec_command",
      call_id: "a",
      arguments: JSON.stringify({
        cmd: "degreaser-axi review --scope worktree --wait 1",
        yield_time_ms: 1,
      }),
    },
    {
      type: "function_call_output",
      call_id: "a",
      output: "Process running with session ID 1234",
    },
    {
      type: "function_call",
      name: "write_stdin",
      call_id: "b",
      arguments: JSON.stringify({
        session_id: 1234,
        chars: "",
        yield_time_ms: 1000,
      }),
    },
  ])
    trace.record({ method: "rawResponseItem/completed", params: { item } });
  assert.equal(trace.events[1]?.handle, "1234");
  assert.equal(trace.events[2]?.handle, "1234");
  assert.equal(trace.events[2]?.operation, "poll");
});

test("Codex code-mode JSON unwraps output and correlates numeric session polling", () => {
  const trace = new CallerEvidence("codex", "model");
  for (const item of [
    {
      type: "custom_tool_call",
      name: "exec",
      call_id: "a",
      input:
        'const r = await tools.exec_command({cmd:"degreaser-axi review --scope worktree --wait 1",yield_time_ms:1}); nodeRepl.write(r)',
    },
    {
      type: "custom_tool_call_output",
      call_id: "a",
      output:
        'Wall time: 1 seconds\nOutput:\n{"wall_time_seconds":1,"session_id":2176,"output":""}',
    },
    {
      type: "custom_tool_call",
      name: "exec",
      call_id: "b",
      input:
        'nodeRepl.write(await tools.write_stdin({session_id:2176,chars:""}))',
    },
    {
      type: "custom_tool_call_output",
      call_id: "b",
      output:
        'Wall time: 1 seconds\nOutput:\n{"exit_code":0,"output":"run: r-20261105-1231-684d\\nstatus: completed\\n"}',
    },
  ])
    trace.record({ method: "rawResponseItem/completed", params: { item } });
  assert.equal(trace.events[1]?.yielded, true);
  assert.equal(trace.events[1]?.handle, "2176");
  assert.equal(trace.events[2]?.operation, "poll");
  assert.equal(trace.events[2]?.handle, "2176");
  assert.equal(trace.events[3]?.status, "completed");
  assert.equal(trace.events[3]?.exit, 0);
});
