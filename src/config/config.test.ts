import assert from "node:assert/strict";
import test from "node:test";
import { ASPECT_IDS } from "../modules/aspect/api.ts";
import { completeConfig, missingConfigFields } from "./defaults.ts";
import { resolveConfig } from "./resolve.ts";
import { validateConfig } from "./validate.ts";

const base = { agent: "claude" as const, model: "sonnet" };
const rc = { ...base, verifier: { model: "opus" } };
const resolve = (data: unknown) => resolveConfig(data, {}, ASPECT_IDS);

test("a valid RC without a verifier is rejected with a pointer to init", () => {
  assert.throws(() => resolve(base), {
    name: /^(Input|Axi)Error$/,
    message: /verifier.*degreaser-axi init/s,
  });
  assert.throws(() => completeConfig(base, ASPECT_IDS), /verifier/);
  assert.throws(() => validateConfig(base), /verifier/);
  assert.deepEqual(validateConfig(base, { requireVerifier: false }), base);
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

test("defaults are 16 workers and a two hour run, and null still means unlimited", () => {
  const config = resolve(rc);
  assert.equal(config.concurrency, 16);
  assert.equal(config.limits.runTimeoutSeconds, 7200);
  assert.equal(resolve({ ...rc, concurrency: null }).concurrency, null);
  assert.equal(resolve({ ...rc, concurrency: 3 }).concurrency, 3);
  const complete = completeConfig(rc, ASPECT_IDS);
  assert.equal(complete.concurrency, 16);
  assert.deepEqual(complete.verifier, { model: "opus" });
});

test("sync reports missing defaults but never invents a verifier", () => {
  const fields = missingConfigFields(rc, ASPECT_IDS).map((m) => m.field);
  assert.ok(fields.includes("concurrency"));
  assert.ok(!fields.includes("verifier"));
});
