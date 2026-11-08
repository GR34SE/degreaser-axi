import assert from "node:assert/strict";
import { join } from "node:path";

import type { InstallContext } from "./fixture.ts";

export async function checkCodex(context: InstallContext) {
  const { home, cwd, evidence, manifest, codex, session } = context;

  assert.equal(manifest.version, "0.165.0");
  const found: Record<string, unknown> = { version: manifest.version };
  evidence.codex = found;
  await session(process.execPath, [codex, "app-server"], async (request) => {
    const init = await request(
      {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "native_install_check", version: "1" },
          capabilities: { experimentalApi: true },
        },
      },
      (e) => e.id === 1,
    );
    assert.ok(init.result, JSON.stringify(init.error));
    const hooks = await request(
      { id: 2, method: "hooks/list", params: { cwds: [cwd] } },
      (e) => e.id === 2,
    );
    const skills = await request(
      {
        id: 3,
        method: "skills/list",
        params: { cwds: [cwd], forceReload: true },
      },
      (e) => e.id === 3,
    );
    const hook = hooks.result?.data
      ?.flatMap((d) => d.hooks ?? [])
      .find((h) => h.command?.includes("degreaser-startup-v1"));
    const skill = skills.result?.data
      ?.flatMap((d) => d.skills ?? [])
      .find((s) => s.name === "degreaser");
    found.hook = hook && {
      source: hook.source,
      sourceMatches: hook.sourcePath === join(home, ".codex/hooks.json"),
      enabled: hook.enabled,
      trustStatus: hook.trustStatus,
    };
    found.skill = skill && {
      scope: skill.scope,
      enabled: skill.enabled,
      pathMatches:
        skill.path === join(home, ".agents/skills/degreaser/SKILL.md"),
    };
    assert.ok(
      hook &&
        hook.source === "user" &&
        hook.sourcePath === join(home, ".codex/hooks.json") &&
        hook.enabled,
      "owned user hook not recognized",
    );
    assert.ok(
      skill &&
        skill.scope === "user" &&
        skill.enabled &&
        skill.path === join(home, ".agents/skills/degreaser/SKILL.md"),
      "user skill not recognized",
    );
  });
}
