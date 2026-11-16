import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
test("a failed build preserves the previous executable distribution", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "degreaser-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of [
    "src",
    "tools",
    "dist",
    "docs",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ])
    cpSync(join(root, path), join(dir, path), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "dist/previous-build"), "previous distribution");
  writeFileSync(
    join(dir, "src/broken.ts"),
    "const value: number = 'wrong';\nexport {value};\n",
  );
  const result = spawnSync(process.execPath, ["tools/build.ts"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /broken\.ts/);
  assert.equal(
    readFileSync(join(dir, "dist/previous-build"), "utf8"),
    "previous distribution",
  );
  const version = spawnSync(process.execPath, ["dist/main.js", "--version"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(version.status, 0, version.stdout + version.stderr);
  assert.equal(version.stdout, "1.0.0\n");
});
