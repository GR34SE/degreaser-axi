import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../../../test/utils/git-fixture.ts";

import { prepareReview } from "../../../test/utils/input.ts";
import { block, clean } from "../../../test/utils/result-fixture.ts";
import { runtime } from "../../../test/utils/runtime.ts";

import { ResultError } from "../../util/errors.ts";
import { parseResult } from "./parse.ts";
import { ingestResult } from "./verify-quotes.ts";

test("only the last complete assistant block is eligible, with strict status and assignment contracts", () => {
  assert.deepEqual(
    parseResult(`Narrative ${block(clean)}`, "low-value-comments"),
    clean,
  );
  for (const text of [
    "",
    `${block(clean)}<degreaser-result>{`,
    `${block(clean)}<degreaser-result>bad</degreaser-result>`,
    block({ ...clean, aspect: "masked-errors" }),
    block({ ...clean, extra: true }),
    block({ ...clean, status: "not-applicable", reason: null }),
    block({ ...clean, status: "not-applicable", reason: " " }),
    block({ ...clean, reason: 5 }),
    block({ ...clean, status: "findings" }),
    block({ ...clean, status: "not-applicable" }),
    block({ ...clean, status: "incomplete", limitations: [" "] }),
  ]) {
    assert.throws(
      () => parseResult(text, "low-value-comments"),
      /result|aspect|schema/i,
    );
  }
  for (const result of [
    { ...clean, status: "not-applicable", reason: "There are no comments." },
    {
      ...clean,
      status: "incomplete",
      limitations: ["Could not read the comment's caller."],
    },
  ])
    assert.deepEqual(parseResult(block(result), "low-value-comments"), result);
});

test("a billing-only refusal is an account failure, not output text", () => {
  assert.throws(
    () =>
      parseResult(
        "\n\nAdd a payment method to continue\n",
        "low-value-comments",
      ),
    (error) =>
      error instanceof ResultError && error.failure === "account-disabled",
  );
  assert.throws(
    () =>
      parseResult(
        "The comment says Add a payment method to continue.",
        "low-value-comments",
      ),
    (error) => error instanceof ResultError && error.failure === undefined,
  );
  assert.deepEqual(
    parseResult(
      `Add a payment method to continue\n${block(clean)}`,
      "low-value-comments",
    ),
    clean,
  );
});

test("examined paths keep only assessed files, and a clean result needs at least one", (t) => {
  const f = fixture(t);
  f.write("current.ts", "export const value = 2;\n");
  const input = prepareReview(
    [
      "--scope",
      "worktree",
      "--task",
      "Update value",
      "--aspects",
      "low-value-comments",
    ],
    f.root,
  );
  const covered = ingestResult(
    runtime(),
    block({
      ...clean,
      examinedPaths: [
        "current.ts",
        `${input.repository}/current.ts`,
        "./current.ts",
        "/elsewhere/outside.ts",
      ],
    }),
    "low-value-comments",
    input,
  );
  assert.equal(covered.result.status, "no-findings");
  assert.deepEqual(covered.result.examinedPaths, ["current.ts"]);
  const unexamined = ingestResult(
    runtime(),
    block({ ...clean, examinedPaths: ["outside.ts"] }),
    "low-value-comments",
    input,
  );
  assert.equal(unexamined.result.status, "incomplete");
  assert.match(unexamined.result.limitations.join(" "), /without examining/);
});

test("semantically empty optional reason is omitted without inventing required content", () => {
  for (const reason of [null, "", "  \n"])
    assert.deepEqual(
      parseResult(block({ ...clean, reason }), "low-value-comments"),
      clean,
    );
  const incomplete = {
    ...clean,
    status: "incomplete",
    limitations: ["Ran out of budget."],
  };
  assert.deepEqual(
    parseResult(block({ ...incomplete, reason: "" }), "low-value-comments"),
    incomplete,
  );
  assert.throws(
    () =>
      parseResult(
        block({ ...clean, status: "incomplete", reason: null }),
        "low-value-comments",
      ),
    /schema/i,
  );
  assert.throws(
    () =>
      parseResult(
        block({ ...clean, unknown: null, reason: null }),
        "low-value-comments",
      ),
    /schema/i,
  );
});
