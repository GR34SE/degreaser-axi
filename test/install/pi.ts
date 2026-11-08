import assert from "node:assert/strict";
import { join } from "node:path";

import type { InstallContext } from "./fixture.ts";

export async function checkPi(context: InstallContext) {
  const { home, cli, evidence, sync, session, acceptedNative } = context;

  const expectedContext = sync(process.execPath, [
    cli,
    "startup-context",
    "--plain",
  ]);
  assert.ok(expectedContext);
  const accepted = acceptedNative("pi", sync("pi", ["--version"]));
  const found: Record<string, unknown> = {
    version: accepted.version,
    ...(accepted.notice ? { notice: accepted.notice } : {}),
  };
  evidence.pi = found;
  await session(
    "pi",
    ["--mode", "rpc", "--offline", "--no-session"],
    async (request) => {
      const commands = await request(
        { id: "commands", type: "get_commands" },
        (e) => e.id === "commands",
      );
      const messages = await request(
        { id: "messages", type: "get_messages" },
        (e) => e.id === "messages",
      );
      const skill = commands.data?.commands?.find(
        (c) => c.name === "skill:degreaser",
      );
      const message = messages.data?.messages?.find(
        (m) => m.customType === "degreaser-startup",
      );
      found.skill = skill && {
        source: skill.source,
        scope: skill.sourceInfo?.scope,
        pathMatches:
          skill.sourceInfo?.path ===
          join(home, ".agents/skills/degreaser/SKILL.md"),
      };
      found.startup = message && {
        delivered: message.content === expectedContext,
        display: message.display,
      };
      assert.ok(
        skill?.source === "skill" &&
          skill.sourceInfo?.scope === "user" &&
          skill.sourceInfo?.path ===
            join(home, ".agents/skills/degreaser/SKILL.md"),
        "user skill not recognized",
      );
      assert.ok(
        message?.content === expectedContext,
        "startup context not delivered",
      );
    },
  );
}
