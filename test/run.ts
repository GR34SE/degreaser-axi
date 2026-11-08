import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = [
  ...globSync(["src/**/*.test.ts", "test/**/*.test.ts"], {
    cwd: root,
    exclude: ["test/live/**", "test/install/**"],
  }),
].sort();
if (!paths.length) throw new Error("No deterministic tests found.");
const result = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2), ...paths],
  { cwd: root, env: process.env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
