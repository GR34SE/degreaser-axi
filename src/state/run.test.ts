import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "./run.ts";
import { stateSchema } from "./schema.ts";

const finding = {
  location: { path: "a.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "// note",
  title: "Narration",
  verdict: "upheld",
  action: "Delete the comment.",
  reason: "Restates the code.",
  evidence: {
    location: { path: "b.ts", side: "new", startLine: 2, endLine: 2 },
    quote: "const b = 1;",
  },
};
const result = {
  aspect: "low-value-comments",
  status: "findings",
  findings: [finding],
  kept: [{ location: finding.location, quote: "// keep" }],
  limitations: [],
  examinedPaths: ["a.ts"],
};
const run = () => ({
  schemaVersion: 1,
  id: "r-20261115-1200-abcd",
  repository: "/repo",
  createdAt: 0,
  deadline: 1,
  status: "completed",
  owner: null,
  identity: "a".repeat(64),
  tasks: [
    {
      assignment: {
        aspect: "low-value-comments",
        agent: "codex",
        model: "gpt-6-luna",
      },
      promptHash: "b".repeat(64),
      status: "findings",
      result,
      rejections: [],
      attempts: [
        {
          startedAt: 0,
          endedAt: 1,
          sessionId: null,
          failure: null,
          stage: "verify",
          portion: { index: 1, paths: 1 },
          result,
        },
      ],
      limitations: [],
      usage: null,
    },
  ],
});

test("stored runs carry verified findings and staged attempts, not worker coverage obligations", () => {
  const validate = stateSchema<Run>("run");
  assert.ok(validate(run()), JSON.stringify(validate.errors));
  for (const mutate of [
    (r: ReturnType<typeof run>) =>
      Object.assign(r.tasks[0] ?? {}, {
        unresolved: { cause: "x", paths: [], stuck: ["a.ts"] },
      }),
    (r: ReturnType<typeof run>) =>
      Object.assign(r.tasks[0]?.result ?? {}, { unresolved: [] }),
    (r: ReturnType<typeof run>) =>
      Object.assign(r.tasks[0]?.attempts[0] ?? {}, { stage: "pass" }),
    (r: ReturnType<typeof run>) =>
      Object.assign(r.tasks[0]?.result.findings[0] ?? {}, {
        verdict: "maybe",
      }),
    (r: ReturnType<typeof run>) =>
      Object.assign(r.tasks[0]?.result.findings[0] ?? {}, {
        consequence: "old prose field",
      }),
  ]) {
    const value = run();
    mutate(value);
    assert.equal(validate(value), false);
  }
});
