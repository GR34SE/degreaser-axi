import { defineHarness } from "../common/definition.ts";
import { modelTier } from "../common/recommend.ts";

export default defineHarness({
  id: "pi",
  displayName: "Pi",
  executables: ["pi"],
  supportedVersions: { verified: "1.4.0", rule: "major" },
  adapterPackage: "pi-acp",
  launcher: new URL("./launcher.js", import.meta.url),
  guarantee:
    "Native read/grep/find/ls/bash tool allowlist; bash limited by the launcher's own extension, which blocks any call that is not a read-only git subcommand with plain arguments. Skills, other extensions, MCP, context files and prompt templates disabled by the worker launcher.",
  limitations: [
    "Native tool allowlist and the bash extension gate are not an OS sandbox for the adapter or for the git commands bash runs.",
    "git keeps user and repository configuration, including diff drivers and textconv filters.",
    "Offline suppresses startup discovery, not subscription model traffic.",
    "Native harness session/cache writes are outside the reviewed source.",
  ],
  integration: {
    extension: new URL("./extension.mjs", import.meta.url),
    directory: ".pi",
    userDirectory: ".pi/agent",
    configRoot: "PI_CODING_AGENT_DIR",
    skill: "shared",
    hook: {
      kind: "extension",
      event: "session_start",
      filename: null,
    },
    activation:
      "Reload Pi or start a new session; approve project resources through the host if required. Installed files do not prove context delivery.",
    invocation: "/skill:degreaser review my changes",
  },
  subscription: (model) =>
    `Pi native credentials (${model.split("/")[0]}); account identity unavailable`,
  recommendationPriority: 2,
  modelTier,
  modelError: (model) =>
    /^[^/\s]+\/\S+$/.test(model)
      ? undefined
      : "Pi requires a provider-qualified model ID.",
  session: { systemPrompt: false, setModel: false, nativeMaxTurns: false },
  configure: async (environment, launcher) => {
    environment.PI_ACP_PI_COMMAND = launcher;
    return "";
  },
});
