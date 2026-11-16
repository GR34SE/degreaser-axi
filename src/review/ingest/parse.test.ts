import assert from "node:assert/strict";
import test from "node:test";
import { ResultError } from "../../util/errors.ts";
import { parseFinder, parseVerifier } from "./parse.ts";

const clean = {
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  limitations: [],
};
const block = (data: unknown) =>
  `<degreaser-result>${JSON.stringify(data)}</degreaser-result>`;
const candidate = {
  location: { path: "a.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "// note",
  title: "Narrating comment",
};

test("only the last complete finder block is eligible, with strict status and assignment contracts", () => {
  assert.deepEqual(
    parseFinder(`Narrative ${block(clean)}`, "low-value-comments"),
    clean,
  );
  for (const text of [
    "",
    `${block(clean)}<degreaser-result>{`,
    `${block(clean)}<degreaser-result>bad</degreaser-result>`,
    block({ ...clean, aspect: "masked-errors" }),
    block({ ...clean, extra: true }),
    block({ ...clean, examinedPaths: ["a.ts"] }),
    block({ ...clean, unresolved: [] }),
    block({ ...clean, status: "not-applicable", reason: null }),
    block({ ...clean, status: "findings" }),
    block({ ...clean, status: "incomplete", limitations: [" "] }),
    block({
      ...clean,
      status: "findings",
      findings: [{ ...candidate, evidence: "prose" }],
    }),
    block({ ...clean, kept: [{ location: candidate.location }] }),
  ])
    assert.throws(
      () => parseFinder(text, "low-value-comments"),
      /result|aspect|schema/i,
    );
  const kept = {
    ...clean,
    status: "findings",
    findings: [candidate],
    kept: [{ location: candidate.location, quote: "// keep" }],
  };
  assert.deepEqual(parseFinder(block(kept), "low-value-comments"), kept);
});

test("a billing-only refusal is an account failure, not output text", () => {
  assert.throws(
    () =>
      parseFinder("\n\nAdd a payment method to continue\n", "masked-errors"),
    (error) =>
      error instanceof ResultError && error.failure === "account-disabled",
  );
  assert.throws(
    () =>
      parseVerifier(
        "The comment says Add a payment method to continue.",
        "masked-errors",
      ),
    (error) => error instanceof ResultError && error.failure === undefined,
  );
});

test("semantically empty optional reason is omitted without inventing required content", () => {
  for (const reason of [null, "", "  \n"])
    assert.deepEqual(
      parseFinder(block({ ...clean, reason }), "low-value-comments"),
      clean,
    );
  assert.throws(
    () =>
      parseFinder(
        block({ ...clean, status: "not-applicable", reason: " " }),
        "low-value-comments",
      ),
    /schema/i,
  );
});

test("finder and verifier paths are normalized inside the repository", () => {
  const found = parseFinder(
    block({
      ...clean,
      status: "findings",
      findings: [
        { ...candidate, location: { ...candidate.location, path: "/r/a.ts" } },
      ],
      kept: [
        { location: { ...candidate.location, path: "./b.ts" }, quote: "x" },
      ],
    }),
    "low-value-comments",
    "/r",
  );
  assert.equal(found.findings[0]?.location.path, "a.ts");
  assert.equal(found.kept?.[0]?.location.path, "b.ts");
  const verdict = {
    candidate: 1,
    verdict: "upheld",
    reason: "Restates the code.",
    action: "Delete the comment.",
    evidence: {
      location: { ...candidate.location, path: "/r/c.ts" },
      quote: "x",
    },
  };
  const verified = parseVerifier(
    block({
      aspect: "low-value-comments",
      status: "verdicts",
      verdicts: [verdict],
      limitations: [],
    }),
    "low-value-comments",
    "/r",
  );
  assert.equal(verified.verdicts[0]?.evidence?.location.path, "c.ts");
  for (const bad of [
    { candidate: 0, verdict: "upheld", reason: "r" },
    { candidate: 1, verdict: "maybe", reason: "r" },
    { candidate: 1, verdict: "refuted" },
    { ...verdict, extra: 1 },
  ])
    assert.throws(
      () =>
        parseVerifier(
          block({
            aspect: "low-value-comments",
            status: "verdicts",
            verdicts: [bad],
            limitations: [],
          }),
          "low-value-comments",
        ),
      /schema/,
    );
  assert.throws(
    () =>
      parseVerifier(
        block({
          aspect: "low-value-comments",
          status: "incomplete",
          verdicts: [],
          limitations: [],
        }),
        "low-value-comments",
      ),
    /schema/,
  );
});
