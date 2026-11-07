import { join } from "node:path";
import {
  AGENTS,
  type Agent,
  configNotice,
  loadConfig,
  readConfigText,
  resolveConfig,
} from "./config.ts";
import { diagnoseFailure, PERMISSION_GUIDANCE } from "./diagnostics.ts";
import { repositoryRoot } from "./git.ts";
import { inspectIntegrations } from "./integration-diagnostics.ts";
import {
  acceptedNativeVersions,
  SUPPORTED_NATIVE_VERSIONS,
} from "./native-compatibility.ts";
import { nativeProfile, PROFILE_LIMITATIONS } from "./native-profile.ts";

const guarantees = {
  codex:
    "Native read-only filesystem sandbox with never approval; shell/code mode remains for reads. Project docs/hooks/delegation/apps/web/MCP are disabled by the worker profile.",
  claude:
    "Native Read/Grep/Glob tool allowlist; settings sources, skills, hooks and MCP disabled by the worker launcher. Managed policy is retained.",
  pi: "Native read/grep/find/ls tool allowlist; skills, extensions, MCP, context files and prompt templates disabled by the worker launcher.",
  cursor:
    "Native ask/read-only mode with sandbox enabled; writes denied by the ACP client. Project MCP/hooks are not a native allowlist.",
};

async function describeProfile(agent: Agent, model: string) {
  const description = {
    agent,
    model,
    supportedNativeVersion: SUPPORTED_NATIVE_VERSIONS[agent],
    acceptedNativeVersions: acceptedNativeVersions(agent),
    guarantee: guarantees[agent],
    limitations: PROFILE_LIMITATIONS[agent],
  };
  try {
    // Without an RC there is no model; a version check needs none.
    const profile = await nativeProfile(
      { agent, model },
      model ? "review" : "model-discovery",
    );
    return {
      ...description,
      compatibility: profile.versionNotice
        ? "unverified-newer-version"
        : "verified-version",
      ...(profile.versionNotice ? { notice: profile.versionNotice } : {}),
      versionSource:
        agent === "codex" ? "installed-package-manifest" : "native-executable",
      nativeVersion: profile.nativeVersion,
      adapterVersion: profile.adapterVersion,
    };
  } catch (error) {
    const failure = diagnoseFailure(error, `${agent} native profile check`);
    return {
      ...description,
      compatibility: "blocked",
      diagnosis: failure.diagnosis,
      reason: failure.message,
      ...failure.details,
      help: failure.help,
    };
  }
}

export async function doctor(cwd: string) {
  const repository = repositoryRoot(cwd);
  // Diagnostics matter most before init, so a missing RC is a finding, not an error.
  const configured =
    readConfigText(join(repository, ".degreaserrc.json")) !== null;
  const config = configured ? loadConfig(repository) : undefined;
  const identities = config
    ? [config, ...resolveConfig(config).assignments]
    : AGENTS.map((agent) => ({ agent, model: "" }));
  const profiles = [];
  const seen = new Set<string>();
  for (const { agent, model } of identities) {
    const key = JSON.stringify([agent, model]);
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push(await describeProfile(agent, model));
  }
  const blocked =
    configured && profiles.some((p) => p.compatibility === "blocked");
  if (blocked) process.exitCode = 2;
  const integrations = inspectIntegrations(repository);
  const repairs = integrations
    .filter((entry) => entry.status === "outdated")
    .map(
      (entry) =>
        `degreaser-axi setup hooks --harnesses ${entry.harness}${entry.scope === "user" ? " --installation-scope user" : ""}`,
    );
  return {
    ...(config
      ? configNotice(config)
      : {
          configuration: "missing",
          configurationHelp:
            "No .degreaserrc.json in this repository; run degreaser-axi init.",
        }),
    status: blocked
      ? "environment-blocked"
      : configured
        ? "checked"
        : "not-configured",
    ...(config ? { agent: config.agent, model: config.model } : {}),
    profiles,
    integrations,
    modelAvailability:
      "Not checked; doctor does not call a model or start adapter sessions.",
    effectiveCapability:
      "Native version compatibility and local installation integrity only; runtime tools, trust, reload, login, connectivity and managed policy are not verified by doctor.",
    caller:
      "Not probed. Sandbox names and network hints alone do not establish a permission denial. An already authorized caller should run the normal review command without escalation.",
    help: [
      PERMISSION_GUIDANCE,
      ...(configured ? [] : ["degreaser-axi init"]),
      ...repairs,
      "Repair only selected owned integrations with degreaser-axi setup hooks --harnesses <targets> --installation-scope <project|user>. Outdated entries repair directly after a package upgrade; resolve modified/unmanaged entries before repair; use native trust/reload controls.",
    ],
  };
}
