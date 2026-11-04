import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "degreaser-package-"));

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, CI: "true" },
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    0,
    `${command}: ${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

try {
  const tarballs = join(temporary, "tarballs");
  run("pnpm", ["pack", "--pack-destination", tarballs], root);
  const packed = await readdir(tarballs);
  assert.equal(packed.length, 1);
  const tarball = join(tarballs, packed[0] ?? "");
  const inventory = run("tar", ["-tzf", tarball], root).trim().split("\n");
  for (const entry of inventory) {
    assert.ok(
      entry === "package/package.json" ||
        entry === "package/README.md" ||
        entry.startsWith("package/dist/"),
      `Unexpected package entry: ${entry}`,
    );
    assert.ok(!entry.endsWith(".ts"), `TypeScript source shipped: ${entry}`);
  }
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      packageManager: "pnpm@12.14.0",
    }),
  );
  await cp(
    join(root, "pnpm-workspace.yaml"),
    join(temporary, "pnpm-workspace.yaml"),
  );
  run("pnpm", ["add", "--ignore-scripts", tarball], temporary);
  const installed = join(temporary, "node_modules/degreaser-axi");
  const bin = join(temporary, "node_modules/.bin/degreaser-axi");
  assert.equal(run(bin, ["--version"], temporary), "0.1.0\n");
  assert.match(run(bin, ["review", "--help"], temporary), /--task-file/);
  assert.equal(
    (await readdir(join(installed, "dist/assets/aspects"))).length,
    16,
  );
  for (const asset of [
    "worker.md",
    "response.md",
    "catalog.md",
    "input-contract.md",
    "schemas/config-v1.json",
    "schemas/input-v1.json",
    "skills/degreaser/SKILL.md",
  ]) {
    assert.ok(
      (await readFile(join(installed, "dist/assets", asset), "utf8")).length >
        200,
    );
  }
  const inputProbe = join(temporary, "input-probe.mjs");
  await writeFile(
    inputProbe,
    `
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const installed = process.argv[2];
const { prepareReview } = await import(pathToFileURL(join(installed, "dist/src/input.js")));
const { validateReviewInput } = await import(pathToFileURL(join(installed, "dist/src/input-schema.js")));
const cwd = mkdtempSync(join(process.argv[3], "input-repo-"));
assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
writeFileSync(join(cwd, ".gitignore"), ".degreaserrc.json\\n");
writeFileSync(join(cwd, ".degreaserrc.json"), JSON.stringify({ agent: "codex", model: "exact-fixture-id" }));
writeFileSync(join(cwd, "source"), "installed input smoke\\n");
const input = prepareReview(["--scope", "worktree", "--task", "Package smoke"], cwd);
assert.equal(input.config.assignments.length, 16);
assert.deepEqual(input.paths.map(p => p.path), [".gitignore", "source"]);
assert.match(input.patch, /\\+installed input smoke/);
assert.deepEqual(validateReviewInput(JSON.parse(JSON.stringify(input))), input);
console.log("Installed input/config schemas and real-Git boundary passed.");
`,
  );
  run(process.execPath, [inputProbe, installed, temporary], temporary);
  const minimumNode = process.env.DEGREASER_NODE24_MIN;
  if (minimumNode) {
    assert.match(run(minimumNode, ["--version"], temporary), /^v24\.0\.0\n$/);
    const cli = join(installed, "dist/bin/degreaser-axi.js");
    assert.equal(run(minimumNode, [cli, "--version"], temporary), "0.1.0\n");
    assert.match(
      run(minimumNode, [cli, "review", "--help"], temporary),
      /--task-file/,
    );
    run(minimumNode, [inputProbe, installed, temporary], temporary);
    console.log(
      "Installed compiled package: Node 24.0.0 version/help and real-Git input passed.",
    );
  } else {
    console.log(
      "Minimum Node 24.0.0 check not run; set DEGREASER_NODE24_MIN to its executable.",
    );
  }
  console.log(
    "Tarball inventory, separate installation, CLI and public assets passed. No live models called.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
