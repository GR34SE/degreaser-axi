import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticError } from "../src/diagnostics.ts";
import {
  assertNativeVersion,
  SUPPORTED_NATIVE_VERSIONS,
} from "../src/native-compatibility.ts";

const refused = (agent: Parameters<typeof assertNativeVersion>[0], v: string) =>
  assert.throws(
    () => assertNativeVersion(agent, v),
    (error) =>
      error instanceof DiagnosticError &&
      error.diagnosis === "unsupported-native-version",
  );

test("verified versions are accepted without a notice", () => {
  for (const agent of ["codex", "claude", "pi", "cursor"] as const)
    assert.deepEqual(
      assertNativeVersion(agent, SUPPORTED_NATIVE_VERSIONS[agent]),
      { version: SUPPORTED_NATIVE_VERSIONS[agent] },
    );
});

test("newer Claude and Pi in the verified major are accepted with a notice", () => {
  for (const [agent, observed] of [
    ["claude", "2.1.319"],
    ["claude", "2.9.0"],
    ["pi", "1.5.0"],
  ] as const) {
    const result = assertNativeVersion(agent, observed);
    assert.equal(result.version, observed);
    assert.match(
      result.notice ?? "",
      new RegExp(`${observed}.*unverified|unverified.*${observed}`, "i"),
    );
  }
});

test("older or different-major Claude and Pi are refused", () => {
  for (const [agent, observed] of [
    ["claude", "2.1.316"],
    ["claude", "2.0.999"],
    ["claude", "3.0.0"],
    ["claude", "1.99.99"],
    ["pi", "1.3.9"],
    ["pi", "2.0.0"],
  ] as const)
    refused(agent, observed);
});

test("Cursor accepts the verified date or later and refuses earlier dates", () => {
  const later = assertNativeVersion("cursor", "2026.11.06-abcdef0");
  assert.match(later.notice ?? "", /unverified/i);
  assert.ok(assertNativeVersion("cursor", "2027.1.2-abcdef0").notice);
  assert.equal(
    assertNativeVersion("cursor", "2026.11.05-abcdef0").notice,
    undefined,
  );
  refused("cursor", "2026.11.04-abcdef0");
  refused("cursor", "2025.12.31-abcdef0");
});

test("Codex requires the exact bundled version", () => {
  refused("codex", "0.165.1");
  refused("codex", "0.164.0");
  refused("codex", "1.0.0");
});

test("malformed output is never echoed", () => {
  const secret = "secret-token-xyz";
  for (const observed of [secret, `2.1.319+${secret}`])
    assert.throws(
      () => assertNativeVersion("claude", observed),
      (error) =>
        error instanceof DiagnosticError &&
        !JSON.stringify(error).includes(secret) &&
        !error.message.includes(secret),
    );
});
