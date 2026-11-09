import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderSkill } from "../../src/install/skill/guidance.ts";
import { ASPECT_IDS } from "../../src/modules/aspect/api.ts";

const root = new URL("../../", import.meta.url);
const checksums = JSON.parse(
  readFileSync(
    new URL("../fixtures/resource-checksums.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;

test("unchanged worker contracts and persisted schemas retain their migration bytes", () => {
  for (const [path, expected] of Object.entries(checksums)) {
    const bytes = readFileSync(new URL(path, root));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expected,
      path,
    );
    assert.deepEqual(
      readFileSync(new URL(path.replace(/^src\//, "dist/"), root)),
      bytes,
      path,
    );
  }
});

test("distribution carries the current rubric bytes without transformation", () => {
  for (const id of ASPECT_IDS) {
    const path = `modules/aspect/${id}/rubric.md`;
    assert.deepEqual(
      readFileSync(new URL(`dist/${path}`, root)),
      readFileSync(new URL(`src/${path}`, root)),
      id,
    );
  }
});

test("generated product skill retains the independently recorded original bytes", () => {
  const original = readFileSync(
    new URL("../fixtures/skill-baseline.md", import.meta.url),
    "utf8",
  );
  assert.equal(renderSkill(), original);
  assert.equal(
    readFileSync(new URL("dist/install/skill/SKILL.md", root), "utf8"),
    original,
  );
});
