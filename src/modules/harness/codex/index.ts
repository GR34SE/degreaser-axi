import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { defineHarness } from "../common/definition.ts";
import { cheapModelRank } from "../common/recommend.ts";
import { codexModelChoices } from "./models.ts";
import { codexConfig } from "./sandbox.ts";

export default defineHarness({
  id: "codex",
  displayName: "Codex",
  executables: ["codex"],
  supportedVersions: { verified: "0.165.0", rule: "exact" },
  adapterPackage: "@agentclientprotocol/codex-acp",
  launcher: new URL("./launcher.js", import.meta.url),
  guarantee:
    "Native read-only filesystem sandbox with never approval; shell/code mode remains for reads. Project docs/hooks/delegation/apps/web/MCP are disabled by the worker profile.",
  limitations: [
    "Native read-only filesystem sandbox permits shell/code execution for reads, not a universal no-exec sandbox.",
    "User skills and managed host policy may remain visible; repository instructions are untrusted evidence.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  integration: {
    directory: ".codex",
    userDirectory: ".codex",
    configRoot: "CODEX_HOME",
    skill: "shared",
    hook: {
      kind: "nested",
      event: "SessionStart",
      filename: "hooks.json",
    },
    activation:
      "Restart Codex; approve project and hook trust in the host. Hooks must be enabled by host policy (default on in 0.165.0). No trust, features or permissions were changed.",
    invocation: "$degreaser review my changes",
    completionNotice:
      "Done. Codex asks you to trust the project and its hook on first start.",
  },
  subscription: () =>
    "OpenAI native subscription; account identity unavailable",
  recommendationPriority: 1,
  modelChoices: codexModelChoices,
  recommendationRank: (model) => {
    const id = model.replace(/^latest:/, "gpt-");
    return id.includes("-") &&
      /(?:^|[-/])luna(?:-|$)/i.test(id) &&
      !/high/i.test(id)
      ? 1
      : cheapModelRank(id);
  },
  modelError: () => undefined,
  session: { systemPrompt: false, setModel: true, nativeMaxTurns: false },
  configure: async (environment, launcher, manifestPath) => {
    const require = createRequire(manifestPath);
    const manifest = JSON.parse(
      await readFile(require.resolve("@openai/codex/package.json"), "utf8"),
    ) as { version: string };
    environment.CODEX_PATH = launcher;
    environment.INITIAL_AGENT_MODE = "read-only";
    environment.CODEX_CONFIG = JSON.stringify(codexConfig);
    return manifest.version;
  },
});
