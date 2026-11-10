import assert from "node:assert/strict";
import test from "node:test";
import { partialOutcome } from "../../eval/provider.mjs";

const data = {
  coverage: [
    { aspect: "masked-errors", status: "no-findings" },
    { aspect: "low-value-comments", status: "incomplete" },
  ],
};
const evidence = { status: "incomplete", findings: [] };

function classify(attempt: Record<string, unknown>) {
  try {
    return partialOutcome(data, {
      execution: [
        { aspect: "masked-errors", attempts: [{ failure: null, result: {} }] },
        { aspect: "low-value-comments", attempts: [attempt] },
      ],
    });
  } catch (error) {
    return (error as Error).message;
  }
}

test("a lifecycle stop is worker quality only after validated evidence without network provenance", () => {
  const recovery = { stage: "internal", recovery: "resume" };
  assert.equal(
    classify({ failure: "timeout", result: evidence, diagnostic: recovery }),
    "worker-quality-partial",
  );
  assert.equal(
    classify({ failure: "deadline", result: evidence, diagnostic: recovery }),
    "worker-quality-partial",
  );
  for (const attempt of [
    { failure: "timeout", result: null, diagnostic: recovery },
    { failure: "deadline", result: null, diagnostic: recovery },
    {
      failure: "timeout",
      result: evidence,
      diagnostic: { ...recovery, detailCode: "ETIMEDOUT" },
    },
    {
      failure: "timeout",
      result: evidence,
      diagnostic: { ...recovery, code: "TIMEOUT" },
    },
    { failure: "network", result: evidence },
    { failure: "cleanup", result: evidence },
  ])
    assert.match(classify(attempt), /not rubric quality evidence/);
  assert.equal(
    classify({ failure: "invalid-output", result: null }),
    "worker-quality-partial",
  );
});
