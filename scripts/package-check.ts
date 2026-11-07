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
        packageManager: "pnpm@12.14.0",
      }),
    );
    await cp(
      join(root, "pnpm-workspace.yaml"),
      join(installDir, "pnpm-workspace.yaml"),
    );
    run("pnpm", ["add", "--ignore-scripts", tarball], installDir, runtime);
    const installed = join(installDir, "node_modules/degreaser-axi");
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
        "0.1.0\n",
      );
      assert.match(
        run(installedBin, ["review", "--help"], installDir, runtime),
        /--task-file/,
      );
    }
    assert.equal(run(runtime, [bin, "--version"], installDir), "0.1.0\n");
    assert.match(
      run(runtime, [bin, "review", "--help"], installDir),
      /--task-file/,
    );
    assert.equal(
      (await readdir(join(installed, "dist/assets/aspects"))).length,
      16,
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
    const inputProbe = join(installDir, "input-probe.mjs");
    await writeFile(
      inputProbe,
      `
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const installed = process.argv[2];
await import(pathToFileURL(join(installed, "dist/src/init-terminal.js")));
const { prepareReview } = await import(pathToFileURL(join(installed, "dist/src/input.js")));
const cwd = mkdtempSync(join(process.argv[3], "input-repo-"));
assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
writeFileSync(join(cwd, ".gitignore"), ".degreaserrc.json\\n/.degreaser/\\n");
writeFileSync(join(cwd, ".degreaserrc.json"), JSON.stringify({ agent: "codex", model: "exact-fixture-id" }));
writeFileSync(join(cwd, "source"), "installed input smoke\\n");
const input = prepareReview(["--scope", "worktree", "--task", "Package smoke"], cwd);
assert.equal(input.config.assignments.length, 16);
assert.deepEqual(input.paths.map(p => p.path), [".gitignore", "source"]);
assert.match(input.patch, /\\+installed input smoke/);
console.log("Installed input/config schemas and real-Git boundary passed.");
const cli = join(installed, "dist/bin/degreaser-axi.js");
for (const args of [
  ["review", "--scope", "repository", "--task", "Installed coordinator-only audit", "--aspects", "scope-creep"],
  ["report", "--full"]
]) {
  const result = spawnSync(process.execPath, [cli, ...args], {cwd,encoding:"utf8",timeout:15000});
  assert.equal(result.status,0,result.stdout + result.stderr);
  assert.match(result.stdout,/status: completed/);
  assert.match(result.stdout,/not-applicable/);
}
console.log("Installed detached owner, storage and report passed without model inference.");
`,
    );
    run(runtime, [inputProbe, installed, installDir], installDir);
    const nativeProbe = join(installDir, "native-probe.mjs");
    await writeFile(
      nativeProbe,
      `
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [installed, temporary] = process.argv.slice(2);
const { nativeProfile } = await import(pathToFileURL(join(installed, "dist/src/native-profile.js")));
const bin = join(temporary, "native-fixtures");
mkdirSync(bin, {recursive:true});
for (const [agent, version] of [["claude","2.1.317"],["pi","1.4.0"],["cursor-agent","2026.11.05-86047df"]]) {
  writeFileSync(join(bin,agent), "#!" + process.execPath + "\\nconsole.log(process.argv.includes('--version') ? " + JSON.stringify(version) + " : JSON.stringify(process.argv.slice(2)));\\n", {mode:0o755});
}
process.env.PATH = bin + ":/usr/bin:/bin";
for (const name of ["HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR"]) {
  process.env[name] = join(temporary, "native-home", name);
  mkdirSync(process.env[name], {recursive:true});
}
for (const agent of ["codex","claude","pi","cursor"]) {
  const profile = await nativeProfile({agent, model:agent === "pi" ? "openai/exact" : agent === "cursor" ? "composer-2.5-fast" : "exact"});
  assert.equal(profile.environment.DEGREASER_WORKER, "1");
  const wrapper = join(installed, "dist/bin", agent + "-worker.js");
  const result = spawnSync(process.execPath, [wrapper, ...(agent === "codex" ? ["--version"] : ["--mode","rpc"])], {
    env: profile.environment, encoding:"utf8", timeout:15000,
  });
  assert.equal(result.status,0,result.stderr);
  if (agent === "codex") assert.match(result.stdout,/0\\.165\\.0/);
  else {
    const args = JSON.parse(result.stdout);
    assert.equal(args[args.indexOf("--model")+1], profile.model);
    if (agent === "cursor") {
      assert.equal(args.at(-1), "acp");
      assert.equal(args[args.indexOf("--mode")+1], "ask");
    } else {
      assert.equal(args[args.indexOf("--tools")+1], agent === "claude" ? "Read,Grep,Glob" : "read,grep,find,ls");
    }
  }
}
await assert.rejects(nativeProfile({agent:"pi",model:"unqualified"}), /provider-qualified/);
writeFileSync(join(bin,"claude"), "#!" + process.execPath + "\\nconsole.log('99.0.0');\\n", {mode:0o755});
await assert.rejects(nativeProfile({agent:"claude",model:"exact"}), /Unsupported claude native version/);
console.log("Installed native resolver and all compiled launchers passed; no model inference.");
`,
    );
    run(runtime, [nativeProbe, installed, installDir], installDir);
    retainInstallation = true;
    process.stdout.write(
      run(
        runtime,
        [join(root, "scripts/qa/scenario.mjs"), installed],
        installDir,
      ),
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
