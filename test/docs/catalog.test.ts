import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { ASPECT_IDS } from "../../src/modules/aspect/api.ts";

const root = new URL("../../dist/modules/aspect/", import.meta.url);

test("distribution carries the fixed seventeen rubrics and 102 contextual examples", () => {
  assert.deepEqual(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    [...ASPECT_IDS].sort(),
  );
  for (const id of ASPECT_IDS) {
    const rubric = readFileSync(new URL(`${id}/rubric.md`, root), "utf8");
    assert.match(rubric, new RegExp(`^# .+\\n\\n\`${id}\` · default ON`));
    for (const section of [
      "Question",
      "Applies when",
      "Evidence",
      "Boundaries",
      "Not here",
    ]) {
      assert.ok(rubric.includes(`**${section}`), `${id}: ${section}`);
    }
    const examples = rubric.split(/^## /m).slice(1);
    assert.equal(examples.length, 6, id);
    assert.equal(
      examples.filter((example) => example.split("\n")[0]?.includes("REPORT"))
        .length,
      3,
      id,
    );
    assert.equal(
      examples.filter((example) => example.split("\n")[0]?.includes("PRESERVE"))
        .length,
      3,
      id,
    );
    for (const example of examples) {
      assert.match(example, /\*\*Context:\*\* .+/);
      assert.match(
        example,
        /```(?:typescript|python|go|javascript|json|sh|bash)/,
      );
      assert.match(example, /\*\*Why:\*\* .+/);
    }
  }
});

test("each neighboring rubric exposes its reciprocal routing boundary", () => {
  const boundary = (id: string) =>
    readFileSync(new URL(`${id}/rubric.md`, root), "utf8")
      .split("**Not here")[1]
      ?.split("## ")[0] ?? "";
  const pairs: [string, string][] = [
    ["unnecessary-complexity", "unnecessary-layers"],
    ["unnecessary-complexity", "speculative-flexibility"],
    ["unnecessary-complexity", "wrong-abstraction"],
    ["unnecessary-complexity", "unidiomatic-code"],
    ["unnecessary-complexity", "structural-erosion"],
    ["unnecessary-complexity", "unjustified-defense"],
    ["unnecessary-complexity", "missed-reuse"],
    ["missed-reuse", "reinvented-infrastructure"],
    ["missed-reuse", "unidiomatic-code"],
    ["missed-reuse", "convention-drift"],
    ["unnecessary-layers", "speculative-flexibility"],
    ["unnecessary-layers", "wrong-abstraction"],
    ["speculative-flexibility", "wrong-abstraction"],
    ["speculative-flexibility", "scope-creep"],
    ["masked-errors", "unjustified-defense"],
    ["masked-errors", "contract-bypass"],
    ["unjustified-defense", "contract-bypass"],
    ["convention-drift", "structural-erosion"],
    ["scope-creep", "incomplete-integration"],
    ["low-value-tests", "verification-theater"],
    ["wrong-abstraction", "structural-erosion"],
    ["low-value-comments", "contract-bypass"],
  ];
  for (const [left, right] of pairs)
    for (const [from, to] of [
      [left, right],
      [right, left],
    ] as const)
      assert.ok(boundary(from).includes(to), `${from} -> ${to}`);
  assert.match(boundary("structural-erosion"), /missed-reuse/);
});
