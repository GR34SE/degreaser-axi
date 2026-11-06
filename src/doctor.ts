import { configNotice, loadConfig, resolveConfig } from "./config.ts";
import { diagnoseFailure, PERMISSION_GUIDANCE } from "./diagnostics.ts";
import { repositoryRoot } from "./git.ts";
import { inspectIntegrations } from "./integration-diagnostics.ts";
import { SUPPORTED_NATIVE_VERSIONS } from "./native-compatibility.ts";
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

export async function doctor(cwd: string) {
  const repository = repositoryRoot(cwd);
  const config = loadConfig(repository);
  const identities = [config, ...resolveConfig(config).assignments];
  const profiles = [];
  const seen = new Set<string>();
  for (const { agent, model } of identities) {
    const key = JSON.stringify([agent, model]);
    if (seen.has(key)) continue;
    seen.add(key);
    const description = {
      agent,
      model,
      supportedNativeVersion: SUPPORTED_NATIVE_VERSIONS[agent],
      guarantee: guarantees[agent],
      limitations: PROFILE_LIMITATIONS[agent],
    };
    try {
      const profile = await nativeProfile({ agent, model });
      profiles.push({
        ...description,
        compatibility: "verified-version",
        nativeVersion: profile.nativeVersion,
        adapterVersion: profile.adapterVersion,
      });
    } catch (error) {
      const failure = diagnoseFailure(error, `${agent} native profile check`);
      profiles.push({
        ...description,
        compatibility: "blocked",
        diagnosis: failure.diagnosis,
        reason: failure.message,
        ...failure.details,
        help: failure.help,
      });
    }
  }
  const blocked = profiles.some((p) => p.compatibility === "blocked");
  if (blocked) process.exitCode = 2;
  return {
    ...configNotice(config),
    status: blocked ? "environment-blocked" : "checked",
    agent: config.agent,
    model: config.model,
    profiles,
    integrations: inspectIntegrations(repository),
    modelAvailability:
      "Not checked; doctor does not call a model or start adapter sessions.",
    effectiveCapability:
      "Native version compatibility and local installation integrity only; runtime tools, trust, reload, login, connectivity and managed policy are not verified by doctor.",
    caller:
      "Not probed. Sandbox names and network hints alone do not establish a permission denial. An already authorized caller should run the normal review command without escalation.",
    help: [
      PERMISSION_GUIDANCE,
      "Repair only selected owned integrations with degreaser-axi setup hooks --harnesses <targets> --installation-scope <project|user>. Resolve modified/unmanaged entries before repair; use native trust/reload controls.",
    ],
  };
}
