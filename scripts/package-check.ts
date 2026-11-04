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
    "skills/degreaser/SKILL.md",
  ]) {
    assert.ok(
      (await readFile(join(installed, "dist/assets", asset), "utf8")).length >
        200,
    );
  }
  const minimumNode = process.env.DEGREASER_NODE24_MIN;
  if (minimumNode) {
    assert.match(run(minimumNode, ["--version"], temporary), /^v24\.0\.0\n$/);
    const cli = join(installed, "dist/bin/degreaser-axi.js");
    assert.equal(run(minimumNode, [cli, "--version"], temporary), "0.1.0\n");
    assert.match(
      run(minimumNode, [cli, "review", "--help"], temporary),
      /--task-file/,
    );
    console.log("Installed compiled package: Node 24.0.0 version/help passed.");
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
