import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CALLER_GUIDANCE, DESCRIPTION } from "../src/guidance.ts";

const path = new URL("../assets/skills/degreaser/SKILL.md", import.meta.url);
const content = `---
name: degreaser
description: Review a code change with focused source-only reviewers, inspect evidence and choose justified fixes. Use when asked to deslop or degrease. Not for Degreaser workers.
---

# Degreaser

${DESCRIPTION}

Development build: all sixteen review aspects, bounded retries/deadlines and same-run waiting are available.
Public cancel stops the run's owned workers and retains useful results. Resume continues only unresolved unchanged input. Init discovers and confirms models and writes the project RC; native startup/skill installation and automatic gitignore setup remain under development.
Use an explicitly installed local package, not an unverified registry download.
Run \`degreaser-axi --help\` or \`degreaser-axi review --help\` for the current interface.
If the binary is unavailable, ask for the local package path; do not install a published version.

${CALLER_GUIDANCE.map((paragraph) => `- ${paragraph}`).join("\n")}
`;

if (process.argv.slice(2).includes("--check")) {
  if ((await readFile(path, "utf8")) !== content) {
    throw new Error(
      "Generated product skill is stale. Run pnpm skill:generate.",
    );
  }
} else {
  await mkdir(new URL(".", path), { recursive: true });
  await writeFile(path, content);
}
