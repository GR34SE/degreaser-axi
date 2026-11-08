import assert from "node:assert/strict";

import { test } from "node:test";

import { CallerEvidence } from "./support/caller-evidence.ts";

test("Cursor startup text counts only before a tool call", () => {
  const trace = new CallerEvidence("cursor", "model");
  trace.record({
    type: "assistant",
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
  assert.equal(trace.events.length, 0);
  assert.equal(trace.context.noHistory, true);
  assert.equal(trace.context.modelReceived, true);
  const late = new CallerEvidence("cursor", "model");
  late.record({
    type: "tool_call",
    subtype: "started",
    call_id: "read",
    tool_call: { readToolCall: { args: { path: ".degreaserrc.json" } } },
  });
  late.record({
    type: "result",
    result:
      'STARTUP {"history":"none","model":"model","run":null,"status":null}',
  });
  assert.equal(late.context.noHistory, false);
});

test("Cursor foreground shell keeps review, wait and skill receipt", () => {
  const trace = new CallerEvidence("cursor", "model");
  const run = "r-20261105-1200-abcd";
  for (const event of [
    {
      type: "tool_call",
      subtype: "started",
      call_id: "skill",
      tool_call: {
        readToolCall: {
          args: { path: ".agents/skills/degreaser/SKILL.md" },
        },
      },
    },
    {
      type: "tool_call",
      subtype: "completed",
      call_id: "skill",
      tool_call: {
        readToolCall: {
          args: { path: ".agents/skills/degreaser/SKILL.md" },
          result: {
            success: { content: "---\nname: degreaser\ndescription: Review\n" },
          },
        },
      },
    },
    {
      type: "tool_call",
      subtype: "completed",
      call_id: "review",
      tool_call: {
        shellToolCall: {
          args: {
            command: "degreaser-axi review --scope worktree --wait 1",
          },
          result: {
            success: {
              exitCode: 3,
              stdout: `run: ${run}\nstatus: running\n`,
              stderr: "",
            },
          },
        },
      },
    },
    {
      type: "tool_call",
      subtype: "started",
      call_id: "wait",
      tool_call: {
        shellToolCall: {
          args: { command: `degreaser-axi wait ${run}` },
        },
      },
    },
    {
      type: "tool_call",
      subtype: "completed",
      call_id: "wait",
      tool_call: {
        shellToolCall: {
          result: {
            success: {
              exitCode: 0,
              stdout: `run: ${run}\nstatus: completed\n`,
            },
          },
        },
      },
    },
    {
      type: "tool_call",
      subtype: "started",
      call_id: "write",
      tool_call: {
        writeToolCall: {
          args: { path: "continuation.txt", fileText: "nonce" },
        },
      },
    },
  ])
    trace.record(event);
  assert.equal(
    trace.events.find((e) => e.kind === "result" && e.operation === "skill")
      ?.skillLoaded,
    true,
  );
  const review = trace.events.find(
    (e) => e.kind === "result" && e.operation === "review",
  );
  assert.equal(review?.status, "running");
  assert.equal(review?.exit, 3);
  assert.equal(review?.run, run);
  assert.equal(review?.yielded, false);
  const waited = trace.events.find(
    (e) => e.kind === "result" && e.operation === "wait",
  );
  assert.equal(waited?.status, "completed");
  assert.equal(waited?.exit, 0);
  assert.ok(
    trace.events.some((e) => e.kind === "call" && e.operation === "continue"),
  );
});

test("skill receipt follows its identity, independently of guidance wording", () => {
  for (const [command, output, loaded] of [
    [
      "cat .agents/skills/degreaser/SKILL.md",
      "---\nname: degreaser\ndescription: Review code\n---\nDo not edit code while a review runs.",
      true,
    ],
    [
      "cat .agents/skills/degreaser/SKILL.md",
      "---\nname: degreaser\ndescription: Review code\n---\nRevised instructions.",
      true,
    ],
    [
      "cat .agents/skills/other/SKILL.md",
      "---\nname: other\n---\nDo not edit code while a run is active",
      false,
    ],
    [
      "degreaser-axi --help",
      "Read the skill: name: degreaser\nDo not edit code while a run is active",
      false,
    ],
    ["cat .agents/skills/degreaser/SKILL.md", "cat: no such file", false],
  ] as const) {
    const trace = new CallerEvidence("codex", "model");
    for (const item of [
      {
        type: "function_call",
        name: "exec_command",
        call_id: "read",
        arguments: JSON.stringify({ cmd: command }),
      },
      { type: "function_call_output", call_id: "read", output },
    ])
      trace.record({ method: "rawResponseItem/completed", params: { item } });
    assert.equal(trace.events[1]?.skillLoaded, loaded, command);
  }
});
