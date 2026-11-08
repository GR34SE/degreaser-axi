import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);

// npm install refuses a package whose os field misses the target. This is that
// check, loaded from the npm that is actually on PATH.
function checkPlatform(os: string) {
  const located = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
  assert.equal(located.status, 0, located.stderr);
  const require = createRequire(
    join(located.stdout.trim(), "npm/package.json"),
  );
  const checks = require("npm-install-checks") as {
    checkPlatform: (
      target: { os?: string[] },
      force?: boolean,
      environment?: { os?: string; cpu?: string },
    ) => void;
  };
  checks.checkPlatform(manifest, false, { os, cpu: "x64" });
}

test("npm accepts this package on Linux and macOS and refuses other operating systems", () => {
  for (const os of ["linux", "darwin"])
    assert.doesNotThrow(() => checkPlatform(os));
  for (const os of ["win32", "freebsd"]) {
    assert.throws(
      () => checkPlatform(os),
      (error: { code?: string }) => error.code === "EBADPLATFORM",
      os,
    );
  }
});
