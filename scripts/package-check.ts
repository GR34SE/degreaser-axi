import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest: { version: string; packageManager: string } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const { values } = parseArgs({
  options: {
    "pack-destination": { type: "string" },
    "current-node-only": { type: "boolean", default: false },
  },
});
const temporary = await mkdtemp(join(tmpdir(), "degreaser-package-"));
let retainInstallation = false;

function run(command: string, args: string[], cwd: string, runtime?: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      CI: "true",
      ...(runtime ? { PATH: `${dirname(runtime)}:${process.env.PATH}` } : {}),
    },
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
  const tarballs = values["pack-destination"]
    ? resolve(values["pack-destination"])
    : join(temporary, "tarballs");
  await mkdir(tarballs, { recursive: true });
  assert.equal(
    (await readdir(tarballs)).length,
    0,
    "Pack destination must be empty.",
  );
  run("pnpm", ["pack", "--pack-destination", tarballs], root);
  const packed = await readdir(tarballs);
  assert.equal(packed.length, 1);
  const tarball = join(tarballs, packed[0] ?? "");
  const inventory = run("tar", ["-tzf", tarball], root).trim().split("\n");
  for (const entry of inventory) {
    assert.ok(
      entry === "package/package.json" ||
        entry === "package/README.md" ||
        entry === "package/LICENSE" ||
        entry.startsWith("package/dist/"),
      `Unexpected package entry: ${entry}`,
    );
    assert.ok(!entry.endsWith(".ts"), `TypeScript source shipped: ${entry}`);
    assert.doesNotMatch(
      entry,
      /(?:^|\/)(?:specs|\.lavish|\.degreaser|\.references|node_modules|coverage|\.env(?:\.[^/]+)?)(?:\/|$)|\.tgz$/,
      `Private material shipped: ${entry}`,
    );
  }
  const minimumNode =
    process.env.DEGREASER_NODE24_MIN ??
    (process.version === "v24.0.0" ? process.execPath : undefined);
  if (!values["current-node-only"]) {
    assert.ok(
      minimumNode,
      "Set DEGREASER_NODE24_MIN to a Node 24.0.0 executable.",
    );
    assert.equal(run(minimumNode, ["--version"], temporary), "v24.0.0\n");
  }
  for (const [index, runtime] of [
    ...new Set([
      process.execPath,
      ...(values["current-node-only"] || !minimumNode ? [] : [minimumNode]),
    ]),
  ].entries()) {
    const installDir = join(temporary, `install-${index}`);
    await mkdir(installDir);
    await writeFile(
      join(installDir, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        packageManager: manifest.packageManager,
      }),
    );
    await cp(
      join(root, "pnpm-workspace.yaml"),
      join(installDir, "pnpm-workspace.yaml"),
    );
    run("pnpm", ["add", "--ignore-scripts", tarball], installDir, runtime);
    const installed = join(installDir, "node_modules/degreaser-axi");
    assert.equal(
      JSON.parse(await readFile(join(installed, "package.json"), "utf8"))
        .license,
      "MIT",
    );
    assert.match(
      await readFile(join(installed, "LICENSE"), "utf8"),
      /^MIT License\n\nCopyright \(c\) 2026 Degreaser contributors\n/,
    );
    const readme = join(installed, "README.md");
    const documentation = await readFile(readme, "utf8");
    for (const [, target] of documentation.matchAll(
      /\[[^\]]+\]\(([^)\s]+)\)/g,
    )) {
      if (!target || /^(?:https?:|#)/.test(target)) continue;
      await readFile(
        resolve(
          dirname(readme),
          decodeURIComponent(target.split("#")[0] ?? ""),
        ),
      );
    }
    for (const [, asset] of documentation.matchAll(/`(dist\/assets\/[^`]+)`/g))
      await readFile(resolve(installed, asset ?? ""));
    const bin = join(installed, "dist/bin/degreaser-axi.js");
    for (const name of ["degreaser", "degreaser-axi"]) {
      const installedBin = join(installDir, "node_modules/.bin", name);
      assert.equal(
        run(installedBin, ["--version"], installDir, runtime),
        `${manifest.version}\n`,
      );
      assert.match(
        run(installedBin, ["review", "--help"], installDir, runtime),
        /--task-file/,
      );
    }
    assert.equal(
      run(runtime, [bin, "--version"], installDir),
      `${manifest.version}\n`,
    );
    assert.match(
      run(runtime, [bin, "review", "--help"], installDir),
      /--task-file/,
    );
    assert.equal(
      (await readdir(join(installed, "dist/assets/aspects"))).length,
      17,
    );
    for (const asset of [
      "worker.md",
      "response.md",
      "catalog.md",
      "input-contract.md",
      "native-profiles.md",
      "result-contract.md",
      "schemas/config-v1.json",
      "schemas/input-v1.json",
      "schemas/result-v1.json",
      "schemas/run-v1.json",
      "schemas/state-v1.json",
      "skills/degreaser/SKILL.md",
    ]) {
      assert.ok(
        (await readFile(join(installed, "dist/assets", asset), "utf8")).trim()
          .length > 0,
      );
    }
    for (const probe of ["input-probe.mjs", "native-probe.mjs"])
      run(
        runtime,
        [join(root, "test/qa", probe), installed, installDir],
        installDir,
      );
    retainInstallation = true;
    process.stdout.write(
      run(runtime, [join(root, "test/qa/scenario.mjs"), installed], installDir),
    );
    retainInstallation = false;
    console.log(
      `Installed package probes and deterministic CLI QA passed on ${runtime}.`,
    );
  }
  console.log(
    "Tarball inventory, separate installation, CLI and public assets passed. No live models called.",
  );
} finally {
  if (retainInstallation)
    console.error(`QA did not complete; retained installation at ${temporary}`);
  else await rm(temporary, { recursive: true, force: true });
}
