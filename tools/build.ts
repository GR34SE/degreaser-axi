import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderSkill } from "../src/install/skill/guidance.ts";
import { VERSION } from "../src/version.ts";

const root = new URL("../", import.meta.url);
const skill = new URL("dist/install/skill/SKILL.md", root);
const args = process.argv.slice(2);

async function catalogSchema(
  path: string,
  updates: Record<string, Record<string, readonly string[] | number>>,
) {
  const url = new URL(`src/${path}.schema.json`, root);
  const original = await readFile(url, "utf8");
  const data = JSON.parse(original) as Record<string, unknown>;
  const before = JSON.stringify(data);
  for (const [path, fields] of Object.entries(updates)) {
    const parent = path
      .split(".")
      .reduce((node, key) => node[key] as Record<string, unknown>, data);
    Object.assign(parent, fields);
  }
  if (JSON.stringify(data) !== before)
    await writeFile(url, `${JSON.stringify(data, null, 2)}\n`);
}

if (args.includes("--check-skill")) {
  if ((await readFile(skill, "utf8")) !== renderSkill())
    throw new Error(
      "Generated product skill is stale. Run pnpm skill:generate.",
    );
} else if (args.includes("--skill-only")) {
  await mkdir(new URL(".", skill), { recursive: true });
  await writeFile(skill, renderSkill());
} else {
  const manifest: { version: string } = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );
  if (manifest.version !== VERSION)
    throw new Error("Package and CLI versions differ.");
  const { AGENTS } = await import("../src/modules/harness/api.ts");
  const { ASPECT_IDS } = await import("../src/modules/aspect/api.ts");
  await catalogSchema("config/config", {
    "definitions.agent": { enum: AGENTS },
    "definitions.aspect": { enum: ASPECT_IDS },
  });
  for (const name of ["result", "find", "verify"])
    await catalogSchema(`review/ingest/${name}`, {
      "properties.aspect": { enum: ASPECT_IDS },
    });
  await catalogSchema("review/input", {
    "properties.config.properties.assignments": { maxItems: ASPECT_IDS.length },
    "properties.workers": { maxItems: ASPECT_IDS.length },
  });
  await catalogSchema("state/run", {
    "properties.tasks": { maxItems: ASPECT_IDS.length },
  });
  const staging = await mkdtemp(
    fileURLToPath(new URL(".degreaser-build-", root)),
  );
  const stagingUrl = pathToFileURL(`${staging}/`);
  const output = new URL("dist/", stagingUrl);
  try {
    await buildDistribution(output);
    const installed = new URL("dist/", root);
    const previous = new URL("previous/", stagingUrl);
    const replacing = existsSync(installed);
    if (replacing) renameSync(installed, previous);
    try {
      renameSync(output, installed);
    } catch (error) {
      if (replacing) renameSync(previous, installed);
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function buildDistribution(output: URL) {
  const { HARNESSES } = await import("../src/modules/harness/api.ts");
  const compile = spawnSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "-p",
      "tsconfig.build.json",
      "--outDir",
      fileURLToPath(output),
    ],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error("TypeScript compilation failed.");
  const source = new URL("src/", root);
  for (const file of await readdir(source, { recursive: true })) {
    if (!/\.(md|json|mjs)$/.test(file)) continue;
    const target = new URL(file, output);
    await mkdir(dirname(fileURLToPath(target)), { recursive: true });
    await copyFile(new URL(file, source), target);
  }
  const generatedSkill = new URL("install/skill/SKILL.md", output);
  await mkdir(new URL(".", generatedSkill), { recursive: true });
  await writeFile(generatedSkill, renderSkill());
  const docs = spawnSync(
    process.execPath,
    ["tools/generate-docs.ts", "--check"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (docs.error) throw docs.error;
  if (docs.status !== 0) throw new Error("Generated documentation is stale.");
  const commit = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const revision =
    commit.status === 0 && /^[a-f0-9]{12}$/.test(commit.stdout.trim())
      ? commit.stdout.trim()
      : null;
  await writeFile(
    new URL("version.js", output),
    `export const VERSION = ${JSON.stringify(VERSION)};\nexport const BUILD_COMMIT = ${JSON.stringify(revision)};\n`,
  );
  await chmod(new URL("main.js", output), 0o755);
  for (const harness of Object.values(HARNESSES)) {
    const path = relative(
      fileURLToPath(source),
      fileURLToPath(harness.launcher),
    );
    await chmod(new URL(path, output), 0o755);
  }
}
