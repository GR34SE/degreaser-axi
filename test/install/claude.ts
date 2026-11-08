import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { InstallContext } from "./fixture.ts";

export async function checkClaude(fixture: InstallContext) {
  const { root, evidence, sync, session, acceptedNative } = fixture;

  const accepted = acceptedNative("claude", sync("claude", ["--version"]));
  const found: Record<string, unknown> = {
    version: accepted.version,
    ...(accepted.notice ? { notice: accepted.notice } : {}),
  };
  evidence.claude = found;
  const debug = join(root, "claude-debug.log");
  await session(
    "claude",
    [
      "--print",
      "--verbose",
      "--debug-file",
      debug,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--setting-sources",
      "user",
      "--strict-mcp-config",
    ],
    async (request) => {
      const init = await request(
        {
          type: "control_request",
          request_id: "init",
          request: { subtype: "initialize" },
        },
        (e) =>
          e.type === "control_response" && e.response?.request_id === "init",
      );
      const skill = init.response?.response?.commands?.find(
        (c) => c.name === "degreaser",
      );
      found.skill = skill && {
        name: skill.name,
        user: skill.description?.endsWith("(user)"),
      };
      assert.ok(
        skill?.description?.endsWith("(user)"),
        "user skill not recognized",
      );
    },
  );
  const debugLines = readFileSync(debug, "utf8").split("\n");
  const finished = debugLines.some(
    (line) =>
      line.includes("SessionStart:startup") &&
      line.includes("degreaser-startup-v1") &&
      line.includes("finished with status 0"),
  );
  const context = debugLines.some(
    (line) =>
      line.includes("degreaser-startup-v1") &&
      line.includes("provided additionalContext"),
  );
  const parsed = debugLines.some((line) =>
    line.includes("Successfully parsed and validated hook JSON output"),
  );
  found.startup = {
    ownedHookSucceeded: finished,
    additionalContextProvided: context,
    jsonValidated: parsed,
  };
  assert.ok(
    finished && context && parsed,
    "owned startup hook did not deliver validated additional context",
  );
}
