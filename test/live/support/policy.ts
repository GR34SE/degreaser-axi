import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const digest = (path: string) =>
  existsSync(path)
    ? createHash("sha256").update(readFileSync(path)).digest("hex")
    : null;
export function policy() {
  const roots = [
    [
      process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      ["config.toml", "hooks.json", "rules"],
    ],
    [
      process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
      ["settings.json"],
    ],
    [
      process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"),
      ["settings.json"],
    ],
  ] as const;
  return roots.flatMap(([root, paths]) =>
    paths.flatMap((p) => {
      const path = join(root, p);
      return p === "rules" && existsSync(path)
        ? readdirSync(path)
            .sort()
            .map((n) => digest(join(path, n)))
        : [digest(path)];
    }),
  );
}
