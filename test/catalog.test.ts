import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../dist/assets/", import.meta.url);
const slugs = [
  "reuse-existing",
  "unnecessary-layers",
  "speculative-flexibility",
  "masked-errors",
  "unjustified-defense",
  "low-value-comments",
  "repo-conventions",
  "scope-creep",
  "contract-bypass",
  "test-value",
  "incomplete-integration",
  "wrong-abstraction",
  "external-library-fit",
  "native-idioms",
  "structural-erosion",
  "verification-theater",
];

test("distribution carries the fixed sixteen rubrics and 96 contextual examples", () => {
  const names = slugs.map(
    (slug, i) => `a${String(i + 1).padStart(2, "0")}-${slug}.md`,
  );
  assert.deepEqual(readdirSync(new URL("aspects/", root)).sort(), names);
  for (const [i, name] of names.entries()) {
    const rubric = readFileSync(new URL(`aspects/${name}`, root), "utf8");
    const id = `A${String(i + 1).padStart(2, "0")}`;
    assert.ok(rubric.startsWith(`# ${id}`));
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
  for (const name of [
    "worker.md",
    "response.md",
    "catalog.md",
    "skills/degreaser/SKILL.md",
  ]) {
    assert.ok(readFileSync(new URL(name, root), "utf8").length > 200, name);
  }
});

test("each neighboring rubric exposes its reciprocal routing boundary", () => {
  const boundaries = slugs.map(
    (slug, i) =>
      readFileSync(
        new URL(`aspects/a${String(i + 1).padStart(2, "0")}-${slug}.md`, root),
        "utf8",
      )
        .split("**Not here")[1]
        ?.split("## ")[0] ?? "",
  );
  const pairs = [
    [1, 13],
    [1, 14],
    [1, 7],
    [2, 3],
    [2, 12],
    [3, 12],
    [3, 8],
    [4, 5],
    [4, 9],
    [5, 9],
    [7, 15],
    [8, 11],
    [10, 16],
    [12, 15],
  ];
  for (const [left, right] of pairs) {
    assert.ok(left && right);
    for (const [from, to] of [
      [left, right],
      [right, left],
    ]) {
      assert.ok(from && to);
      assert.ok(
        boundaries[from - 1]?.includes(`A${String(to).padStart(2, "0")}`),
        `${from} -> ${to}`,
      );
    }
  }
  assert.match(boundaries[5] ?? "", /A09/);
  assert.match(boundaries[14] ?? "", /A01/);
});
