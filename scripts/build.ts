import { spawnSync } from "node:child_process";
import { chmod, cp, readFile, rm } from "node:fs/promises";
import { VERSION } from "../src/version.ts";

const root = new URL("../", import.meta.url);
const manifest: { version: string } = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
if (manifest.version !== VERSION)
  throw new Error("Package and CLI versions differ.");
const skill = spawnSync(
  process.execPath,
  ["scripts/generate-skill.ts", "--check"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (skill.error) throw skill.error;
if (skill.status !== 0) process.exit(skill.status ?? 1);
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
await cp(new URL("assets/", root), new URL("dist/assets/", root), {
  recursive: true,
});
await chmod(new URL("dist/bin/degreaser-axi.js", root), 0o755);
