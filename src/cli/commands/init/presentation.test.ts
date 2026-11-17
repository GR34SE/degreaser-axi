import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "../../../config/types.ts";
import type { Catalog } from "./catalog.ts";
import { decisionRequired } from "./presentation.ts";

const candidates = ["haiku", "sonnet", "opus"].map((model) => ({
  agent: "claude" as const,
  model,
  account: "",
  label: model,
}));
const choices: Catalog = {
  candidates,
  discovery: [],
  recommendation: { agent: "claude", model: "sonnet" },
};
const decide = (
  requested: {
    agent?: Agent;
    model?: string;
    verifierAgent?: Agent;
    verifierModel?: string;
    harnesses?: Agent[];
  },
  previous?: Parameters<typeof decisionRequired>[1],
) =>
  decisionRequired(choices, previous, requested, "project") as unknown as {
    missing: string[];
    prefill: unknown;
    verifierPrefill: unknown;
    help: string[];
  };

test("an explicit verifier agent without a model remains a missing decision", () => {
  const result = decide({
    agent: "claude",
    model: "sonnet",
    verifierAgent: "claude",
    harnesses: ["claude"],
  });
  assert.deepEqual(result.missing, ["verifier-model"]);
  assert.deepEqual(result.verifierPrefill, { agent: "claude", model: "opus" });
  assert.match(
    result.help[0] ?? "",
    /--agent claude --model 'sonnet' --verifier-model 'opus' --harnesses claude/,
  );
  assert.doesNotMatch(result.help[0] ?? "", /--verifier-agent/);
});

test("a previous verifier is prefill and a different verifier agent is named in commands", () => {
  const previous = {
    agent: "claude" as const,
    model: "haiku",
    verifier: { model: "sonnet" },
  };
  assert.deepEqual(decide({}, previous).verifierPrefill, {
    agent: "claude",
    model: "sonnet",
  });
  const result = decide({
    agent: "claude",
    model: "sonnet",
    verifierAgent: "claude",
    verifierModel: "opus",
  });
  assert.deepEqual(result.missing, ["harnesses"]);
});

test("a finder choice without verifier flags keeps the separate-verifier suggestion", () => {
  const finder = { agent: "claude" as const, model: "sonnet" };
  const fresh = decide(finder);
  assert.deepEqual(fresh.missing, ["harnesses"]);
  assert.deepEqual(fresh.verifierPrefill, { agent: "claude", model: "opus" });
  assert.match(
    fresh.help[0] ?? "",
    /--agent claude --model 'sonnet' --verifier-model 'opus' --harnesses /,
  );
  assert.deepEqual(
    decide(finder, { ...finder, verifier: { model: "haiku" } }).verifierPrefill,
    { agent: "claude", model: "haiku" },
  );
  assert.deepEqual(
    decide(
      { ...finder, verifierModel: "haiku" },
      { ...finder, verifier: { model: "opus" } },
    ).verifierPrefill,
    { agent: "claude", model: "haiku" },
  );
});

test("everything missing is reported together", () => {
  assert.deepEqual(decide({}).missing, ["model", "harnesses"]);
});
