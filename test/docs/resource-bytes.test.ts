import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderSkill } from "../../src/install/skill/guidance.ts";

const root = new URL("../../", import.meta.url);
const checksums = JSON.parse(
  readFileSync(
    new URL("../fixtures/resource-checksums.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;

test("migrated prompts, rubrics and persisted schemas retain their original bytes", () => {
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
