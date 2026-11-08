import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
  const { HARNESSES, AGENTS } = await import("../src/modules/harness/api.ts");
  const { ASPECT_IDS } = await import("../src/modules/aspect/api.ts");
  await catalogSchema("config/config", {
    "definitions.agent": { enum: AGENTS },
    "definitions.aspect": { enum: ASPECT_IDS },
  });
  await catalogSchema("review/ingest/result", {
    "properties.aspect": { enum: ASPECT_IDS },
  });
  await catalogSchema("review/input", {
    "properties.config.properties.assignments": { maxItems: ASPECT_IDS.length },
    "properties.workers": { maxItems: ASPECT_IDS.length },
  });
  await catalogSchema("state/run", {
    "properties.tasks": { maxItems: ASPECT_IDS.length },
  });
  await rm(new URL("dist/", root), { recursive: true, force: true });
  const compile = spawnSync(
    "pnpm",
    ["exec", "tsc", "-p", "tsconfig.build.json"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) process.exit(compile.status ?? 1);
  const source = new URL("src/", root);
  for (const file of await readdir(source, { recursive: true })) {
    if (!/\.(md|json|mjs)$/.test(file)) continue;
    const target = new URL(`dist/${file}`, root);
    await mkdir(dirname(fileURLToPath(target)), { recursive: true });
    await copyFile(new URL(file, source), target);
  }
  await mkdir(new URL(".", skill), { recursive: true });
  await writeFile(skill, renderSkill());
  const docs = spawnSync(
    process.execPath,
    ["tools/generate-docs.ts", "--check"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (docs.error) throw docs.error;
  if (docs.status !== 0) process.exit(docs.status ?? 1);
  await chmod(new URL("dist/main.js", root), 0o755);
  for (const harness of Object.values(HARNESSES)) {
    const path = relative(
      fileURLToPath(source),
      fileURLToPath(harness.launcher),
    );
    await chmod(new URL(`dist/${path}`, root), 0o755);
  }
}
