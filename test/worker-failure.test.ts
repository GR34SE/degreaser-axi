import assert from "node:assert/strict";
import test from "node:test";
import { workerFailure } from "../src/worker-failure.ts";

test("structured runtime causes take precedence over loose messages", () => {
  for (const [error, expected] of [
    [
      {
        code: "RUNTIME",
        detailCode: "AUTH_REQUIRED",
        message: "Rate limit policy",
      },
      "authentication",
    ],
    [
      new Error("Authentication failed", { cause: { code: "EACCES" } }),
      "environment-blocked",
    ],
    [
      {
        code: "ACP_SESSION_INIT_FAILED",
        cause: { name: "TimeoutError" },
        message: "Adapter failed",
      },
      "timeout",
    ],
    [
      { code: "ACP_MODEL_UNSUPPORTED", message: "Permission denied" },
      "model-unavailable",
    ],
    [{ status: 429, message: "Login failed" }, "rate-limited"],
    [
      { code: "INSUFFICIENT_QUOTA", message: "Opaque provider response" },
      "rate-limited",
    ],
    [
      { code: "EPERM", message: "Opaque launch failure" },
      "environment-blocked",
    ],
    [
      { code: "ECONNRESET", message: "Author policy record missing" },
      "runtime",
    ],
  ] as const)
    assert.equal(workerFailure(error), expected);
});
