import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "../../../config/types.ts";
import { HARNESSES } from "../../../modules/harness/api.ts";
import { recommend, recommendVerifier } from "./recommend.ts";

const ids = (agent: Agent, models: string[]) =>
  models.map((model) => ({ agent, model }));

const catalogs: [Agent, string[], string, string][] = [
  [
    "claude",
    ["sonnet", "opus", "haiku", "claude-haiku-4-5-20251001", "claude-opus-4-5"],
    "sonnet",
    "opus",
  ],
  [
    "claude",
    ["claude-haiku-4-5-20251001", "claude-sonnet-4-5", "claude-opus-4-5"],
    "claude-sonnet-4-5",
    "claude-opus-4-5",
  ],
  [
    "codex",
    [
      "latest:astra",
      "latest:luna",
      "latest:terra",
      "latest:sol",
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-6.1-terra",
      "gpt-6.1-sol",
    ],
    "latest:terra",
    "latest:sol",
  ],
  [
    "pi",
    [
      "openai/gpt-6-mini",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-opus-4-5",
    ],
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-opus-4-5",
  ],
  [
    "cursor",
    ["composer-2.5-fast", "claude-4.5-sonnet", "claude-4.5-opus-high"],
    "claude-4.5-sonnet",
    "claude-4.5-opus-high",
  ],
];

for (const [agent, models, worker, verifier] of catalogs)
  test(`${agent}: workers take the middle tier and the verifier the strongest`, () => {
    const candidates = ids(agent, models);
    assert.equal(recommend(candidates)?.model, worker);
    assert.equal(recommendVerifier(candidates)?.model, verifier);
  });

test("no tier falls back: without a middle or strongest model init recommends nothing", () => {
  assert.equal(recommend(ids("claude", ["haiku", "opus"])), null);
  assert.equal(recommendVerifier(ids("claude", ["haiku", "sonnet"])), null);
  assert.equal(recommend(ids("codex", ["gpt-x"])), null);
  assert.equal(recommendVerifier(ids("codex", ["gpt-x"])), null);
  assert.equal(HARNESSES.claude.modelTier("haiku"), "light");
  assert.equal(recommend(ids("codex", ["latest:astra", "gpt-6-luna"])), null);
  assert.equal(
    recommendVerifier(ids("codex", ["gpt-6-astra", "gpt-6.1-terra"])),
    null,
  );
  assert.equal(HARNESSES.codex.modelTier("gpt-6-luna-high"), "light");
});

test("within a tier the agent the terminal flow prefers wins over catalog order", () => {
  assert.deepEqual(
    recommend([
      ...ids("cursor", ["claude-4.5-sonnet"]),
      ...ids("codex", ["gpt-6-terra"]),
      ...ids("claude", ["sonnet"]),
    ]),
    { agent: "claude", model: "sonnet" },
  );
  assert.deepEqual(
    recommendVerifier([
      ...ids("pi", ["anthropic/claude-opus-4-5"]),
      ...ids("codex", ["gpt-6-sol"]),
    ]),
    { agent: "codex", model: "gpt-6-sol" },
  );
  assert.deepEqual(
    recommend([...ids("claude", ["haiku"]), ...ids("codex", ["gpt-6-terra"])]),
    { agent: "codex", model: "gpt-6-terra" },
  );
});
