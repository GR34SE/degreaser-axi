import { defineHarness } from "../common/definition.ts";
import { cheapModelRank } from "../common/recommend.ts";

const latestAliases = new Set(["sonnet", "opus", "haiku", "fable"]);

export default defineHarness({
  id: "claude",
  displayName: "Claude Code",
  executables: ["claude"],
  supportedVersions: { verified: "2.1.317", rule: "major" },
  adapterPackage: "@agentclientprotocol/claude-agent-acp",
  launcher: new URL("./launcher.js", import.meta.url),
  guarantee:
    "Native Read/Grep/Glob tool allowlist; settings sources, skills, hooks and MCP disabled by the worker launcher. Managed policy is retained.",
  limitations: [
    "Native Read/Grep/Glob allowlist is not an OS sandbox for the adapter.",
    "Managed host policy is retained; conflicting policy blocks operation. Harmless plugin metadata may remain.",
    "Claude's review catalog includes the requested model; its identity check does not prove provider availability.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  integration: {
    directory: ".claude",
    userDirectory: ".claude",
    configRoot: "CLAUDE_CONFIG_DIR",
    skill: "native",
    hook: {
      kind: "nested",
      event: "SessionStart",
      filename: "settings.json",
    },
    activation:
      "Start a new Claude session; project trust and host hook policy still apply. Installed files do not prove context delivery.",
    invocation: "/degreaser review my changes",
  },
  subscription: () =>
    "Claude native subscription; account identity unavailable",
  recommendationPriority: 0,
  modelChoices: (models) =>
    [...models]
      .sort(
        (a, b) => Number(latestAliases.has(b)) - Number(latestAliases.has(a)),
      )
      .map((model) => ({
        model,
        label: latestAliases.has(model) ? `${model} (latest)` : model,
        resolvedModel: model,
      })),
  recommendationRank: (model) =>
    model === "haiku" ||
    (model.includes("-") && /(?:^|[-/])haiku(?:-|$)/i.test(model))
      ? 0
      : cheapModelRank(model),
  modelError: () => undefined,
  session: {
    systemPrompt: true,
    allowedTools: ["Read", "Grep", "Glob"],
    setModel: true,
    nativeMaxTurns: true,
  },
  configure: async (environment, launcher) => {
    environment.CLAUDE_CODE_EXECUTABLE = launcher;
    environment.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
    environment.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = "false";
    environment.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
    return "";
  },
});
