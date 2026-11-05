import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    since: { type: "string" },
    output: { type: "string" },
  },
});
assert.ok(
  values.since && values.output,
  "Pass --since <commit-or-tag> --output <new-directory>.",
);
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(values.output);
const scripts = fileURLToPath(new URL("./", import.meta.url));
function run(command: string, args: string[], capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    timeout: 600_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    0,
    `${command} failed; no release candidate prepared.`,
  );
  return result.stdout;
}
assert.equal(
  run("git", ["status", "--porcelain", "--untracked-files=normal"], true),
  "",
  "Commit or set aside checkout changes before preparing a release candidate.",
);
const notes = run(
  process.execPath,
  [join(scripts, "release-notes.ts"), "--since", values.since],
  true,
);
await mkdir(output);
try {
  run("pnpm", ["build"]);
  run(process.execPath, [
    join(scripts, "package-check.ts"),
    "--pack-destination",
    output,
  ]);
  const [tarball] = await readdir(output);
  assert.ok(tarball, "Package check produced no tarball.");
  const digest = createHash("sha256")
    .update(await readFile(join(output, tarball)))
    .digest("hex");
  await writeFile(join(output, "SHA256SUMS"), `${digest}  ${tarball}\n`);
  await writeFile(join(output, "RELEASE_NOTES.md"), notes);
  console.log(
    `Prepared ${output}: installed tarball, SHA256SUMS and draft notes. Nothing published.`,
  );
} catch (error) {
  await rm(output, { recursive: true, force: true });
  throw error;
}
