import assert from "node:assert/strict";
import test from "node:test";
import { ASPECT_IDS } from "../modules/aspect/api.ts";
import { completeConfig, missingConfigFields } from "./defaults.ts";
import { resolveConfig } from "./resolve.ts";
import { validateConfig } from "./validate.ts";

const base = { agent: "claude" as const, model: "sonnet" };
const rc = { ...base, verifier: { model: "opus" } };
const resolve = (data: unknown) => resolveConfig(data, {}, ASPECT_IDS);

test("an RC without a verifier verifies with the finder identity", () => {
  assert.deepEqual(resolve(base).verifier, base);
  assert.equal(
    Object.hasOwn(completeConfig(base, ASPECT_IDS), "verifier"),
    false,
  );
  assert.deepEqual(validateConfig(base), base);
});

test("a model-only verifier inherits the worker agent and an agent needs a model", () => {
  assert.deepEqual(resolve(rc).verifier, { agent: "claude", model: "opus" });
  assert.deepEqual(
    resolve({ ...base, verifier: { agent: "codex", model: "latest:sol" } })
      .verifier,
    { agent: "codex", model: "latest:sol" },
  );
  for (const verifier of [
    { agent: "codex" },
    {},
    { model: " " },
    { agent: "grok", model: "x" },
    { model: "opus", extra: 1 },
    "opus",
    null,
  ])
    assert.throws(() => resolve({ ...base, verifier }), {
      name: /^(Input|Axi)Error$/,
    });
});

test("Pi verifiers need provider-qualified models, inherited or explicit", () => {
  const pi = { agent: "pi", model: "openai/gpt-6-luna" };
  assert.throws(
    () => resolve({ ...pi, verifier: { model: "gpt-6-sol" } }),
    /verifier.*provider|provider/,
  );
  assert.throws(
    () => resolve({ ...base, verifier: { agent: "pi", model: "x" } }),
    /pattern|provider/,
  );
  assert.deepEqual(
    resolve({ ...pi, verifier: { model: "openai/gpt-6-sol" } }).verifier,
    { agent: "pi", model: "openai/gpt-6-sol" },
  );
});

test("concurrency defaults to one slot per selected aspect; an RC value is only a cap", () => {
  const config = resolve(rc);
  assert.equal(config.concurrency, ASPECT_IDS.length);
  assert.equal(
    resolveConfig(rc, { aspects: ["missed-reuse", "scope-creep"] }, ASPECT_IDS)
      .concurrency,
    2,
  );
  assert.equal(resolve({ ...rc, concurrency: 3 }).concurrency, 3);
  assert.throws(() => resolve({ ...rc, concurrency: null }), /concurrency/);
  const complete = completeConfig(rc, ASPECT_IDS);
  assert.equal(Object.hasOwn(complete, "concurrency"), false);
  assert.deepEqual(complete.verifier, { model: "opus" });
});

test("limits default to an 1800 s run, 900 s per worker and a 180 s idle stop", () => {
  assert.deepEqual(resolve(rc).limits, {
    workerTimeoutSeconds: 900,
    workerIdleSeconds: 180,
    maxTurns: 40,
    runTimeoutSeconds: 1800,
  });
});

test("sync reports missing defaults but never invents a verifier or a concurrency", () => {
  const fields = missingConfigFields(rc, ASPECT_IDS).map((m) => m.field);
  assert.ok(!fields.includes("concurrency"));
  assert.ok(!fields.includes("verifier"));
});
