import assert from "node:assert/strict";
import test from "node:test";
import { failureDiagnostic, workerFailure } from "../src/worker-failure.ts";

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
    [{ message: "Account usage limit reached" }, "rate-limited"],
    [{ message: "Rate limit 429" }, "rate-limited"],
    [{ message: "Cannot decode author record" }, "runtime"],
    [{ message: "Cannot decode policy record" }, "runtime"],
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
      "network",
    ],
  ] as const)
    assert.equal(workerFailure(error), expected);
});

for (const [name, error, expected] of [
  [
    "disabled code",
    { code: "ACCOUNT_DISABLED", message: "Quota exhausted" },
    "account-disabled",
  ],
  [
    "suspended detail",
    { detailCode: "ACCOUNT_SUSPENDED", status: 429 },
    "account-disabled",
  ],
  [
    "wrapped disabled code",
    { status: 429, cause: { code: "ACCOUNT_DISABLED" } },
    "account-disabled",
  ],
  ["HTTP status", { status: 429, message: "Opaque failure" }, "rate-limited"],
  ["HTTP statusCode", { statusCode: 429 }, "rate-limited"],
  ["HTTP message", new Error("HTTP 429: Too Many Requests"), "rate-limited"],
  [
    "status message",
    new Error("Request failed with status code 429"),
    "rate-limited",
  ],
  [
    "unrelated number",
    new Error("Cannot decode record 429 in provider response"),
    "runtime",
  ],
  [
    "unrelated count",
    new Error("Read 429 records before connection closed"),
    "runtime",
  ],
  ["disabled prose", new Error("Account disabled"), "account-disabled"],
  ["suspended prose", new Error("Account suspended"), "account-disabled"],
  [
    "disabled HTTP response",
    { status: 429, message: "Account disabled" },
    "account-disabled",
  ],
  [
    "suspended HTTP response",
    { status: 429, message: "Account suspended" },
    "account-disabled",
  ],
  [
    "disabled numeric HTTP code",
    { code: 429, message: "Account disabled" },
    "account-disabled",
  ],
  [
    "suspended string HTTP code",
    { code: "429", message: "Account suspended" },
    "account-disabled",
  ],
  ["numeric HTTP code", { code: 429 }, "rate-limited"],
  ["string HTTP code", { code: "429" }, "rate-limited"],
] as const) {
  test(`failure classification: ${name}`, () => {
    assert.equal(workerFailure(error), expected);
  });
}

test("the billing sentence is not an account failure without a machine code", () => {
  assert.equal(
    workerFailure(new Error("Add a payment method to continue")),
    "runtime",
  );
  assert.equal(
    workerFailure({
      message: "Add a payment method to continue",
      model: "claude-haiku-5-5",
    }),
    "runtime",
  );
  assert.equal(
    workerFailure({
      code: "ACCOUNT_DISABLED",
      message: "Add a payment method to continue",
      model: "grok-4.7-xhigh",
    }),
    "account-disabled",
  );
});

test("diagnostics keep only recognized machine fields", () => {
  assert.deepEqual(
    failureDiagnostic(
      "turn-result",
      "rate-limited",
      {
        code: "ACP_TURN_FAILED",
        detailCode: "sk-secret-token",
        retryable: false,
        message: "private provider text",
      },
      "max_tokens",
    ),
    {
      stage: "turn-result",
      recovery: "wait-for-quota",
      code: "ACP_TURN_FAILED",
      retryable: false,
      stopReason: "max_tokens",
    },
  );
  assert.deepEqual(
    failureDiagnostic("usage", "runtime", { code: "weird" }, "x"),
    {
      stage: "usage",
      recovery: "inspect",
    },
  );
});
