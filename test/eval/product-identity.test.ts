import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { productIdentity } from "../../eval/product-identity.mjs";

test("identity captures dirty built prompts and rejects symlinked product resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-product-"));
  try {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "pnpm-lock.yaml"), "lock");
    const resource = join(root, "dist/rubric.md");
    await writeFile(resource, "baseline");
    const baseline = await productIdentity(root);
    assert.equal(await productIdentity(root), baseline);
    await writeFile(resource, "candidate");
    assert.notEqual(await productIdentity(root), baseline);
    await symlink(resource, join(root, "dist/escape.md"));
    await assert.rejects(productIdentity(root), /symlink/);
  } finally {
    await rm(root, { recursive: true });
  }
});
