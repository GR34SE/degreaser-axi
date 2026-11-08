import assert from "node:assert/strict";

import { test } from "node:test";

test("adapter environment is allowlisted even when acpx promotes inherited auth grants", async () => {
  const { workerEnvironment } = await import("./isolation.ts");
  const env = workerEnvironment({
    HOME: "/fixture/home",
    PATH: "/usr/bin",
    CODEX_HOME: "/fixture/auth",
    OPENAI_API_KEY: "synthetic-secret",
    ACPX_AUTH_OPENAI_API_KEY: "synthetic-secret",
    NODE_OPTIONS: "--require malicious",
    HTTPS_PROXY: "https://bad.invalid",
    DEGREASER_WORKER: "0",
    CLAUDE_CODE_USE_BEDROCK: "1",
  });
  assert.deepEqual(env, {
    HOME: "/fixture/home",
    PATH: "/usr/bin",
    CODEX_HOME: "/fixture/auth",
    DEGREASER_WORKER: "1",
  });
});
