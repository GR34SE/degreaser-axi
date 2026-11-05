import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  CALLER_GUIDANCE,
  DESCRIPTION,
  SKILL_DESCRIPTION,
} from "../src/guidance.ts";

const path = new URL("../assets/skills/degreaser/SKILL.md", import.meta.url);
const content = `---
name: degreaser
description: ${SKILL_DESCRIPTION}
---

# Degreaser

${DESCRIPTION}

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
