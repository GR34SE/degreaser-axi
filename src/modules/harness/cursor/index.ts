import { defineHarness } from "../common/definition.ts";
import { cheapModelRank } from "../common/recommend.ts";

export default defineHarness({
  id: "cursor",
  displayName: "Cursor",
  executables: ["cursor-agent", "agent"],
  supportedVersions: { verified: "2026.11.05-86047df", rule: "date" },
  adapterPackage: null,
  launcher: new URL("./launcher.js", import.meta.url),
  guarantee:
    "Native ask/read-only mode with sandbox enabled; writes denied by the ACP client. Project MCP/hooks are not a native allowlist.",
  limitations: [
    "Ask mode is native read-only behavior, not an OS sandbox around the ACP process.",
    "Repository rules (AGENTS.md, CLAUDE.md), project MCP, hooks, plugins and skills may remain visible; repository instructions are untrusted evidence.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  integration: {
    directory: ".cursor",
    userDirectory: ".cursor",
    skill: "shared",
    hook: {
      kind: "flat",
      event: "sessionStart",
      filename: "hooks.json",
      version: 1,
      arguments: ["--cursor"],
    },
    activation:
      "Start a new Cursor agent chat; project trust still applies. Installed files do not prove context delivery.",
    invocation: "/degreaser review my changes",
  },
  subscription: () =>
    "Cursor native subscription; account identity unavailable",
  recommendationPriority: 2,
  recommendationRank: cheapModelRank,
  modelError: () => undefined,
  session: {
    systemPrompt: false,
    mode: "ask",
    modeNotice:
      "Cursor session mode was not confirmed; argv requests ask mode and writes are denied.",
    setModel: true,
    nativeMaxTurns: false,
  },
});
