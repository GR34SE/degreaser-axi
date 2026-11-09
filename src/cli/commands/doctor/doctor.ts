import { ASPECT_IDS } from "../../../modules/aspect/api.ts";

export { spec } from "./spec.ts";

import { join } from "node:path";
import { configNotice } from "../../../config/defaults.ts";
import { readConfigText } from "../../../config/load.ts";
import { resolveConfig } from "../../../config/resolve.ts";
import type { Agent } from "../../../config/types.ts";
import { inspectIntegrations } from "../../../install/inspect.ts";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import {
  acceptedNativeVersions,
  SUPPORTED_NATIVE_VERSIONS,
} from "../../../modules/harness/common/compatibility.ts";
import {
  nativeProfile,
  PROFILE_LIMITATIONS,
} from "../../../modules/harness/common/profile.ts";
import {
  diagnoseFailure,
  PERMISSION_GUIDANCE,
} from "../../../util/diagnostics.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";

async function describeProfile(f: Factory, agent: Agent, model: string) {
  const description = {
    agent,
    model,
    supportedNativeVersion: SUPPORTED_NATIVE_VERSIONS[agent],
    acceptedNativeVersions: acceptedNativeVersions(agent),
    guarantee: HARNESSES[agent].guarantee,
    limitations: PROFILE_LIMITATIONS[agent],
  };
  try {
    const profile = await nativeProfile(
      f,
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
        HARNESSES[agent].supportedVersions.rule === "exact"
          ? "installed-package-manifest"
          : "native-executable",
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

export async function run(f: Factory) {
  const repository = repositoryRoot(f, f.cwd);
  const configured =
    readConfigText(join(repository, ".degreaserrc.json")) !== null;
  const config = configured ? f.config(repository) : undefined;
  const identities = config
    ? [config, ...resolveConfig(config, {}, ASPECT_IDS).assignments]
    : AGENTS.map((agent) => ({ agent, model: "" }));
  const profiles = [];
  const seen = new Set<string>();
  for (const { agent, model } of identities) {
    const key = JSON.stringify([agent, model]);
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push(await describeProfile(f, agent, model));
  }
  const blocked =
    configured && profiles.some((p) => p.compatibility === "blocked");
  const integrations = inspectIntegrations(f, repository);
  const repairs = (["project", "user"] as const).flatMap((scope) => {
    const entries = integrations.filter((entry) => entry.scope === scope);
    const linked = entries.some(
      (entry) =>
        HARNESSES[entry.harness].integration.skill === "native" &&
        entry.status === "outdated" &&
        entry.files.some((file) => !file.path.endsWith("SKILL.md")),
    );
    const harnesses = entries
      .filter(
        (entry) =>
          entry.status === "outdated" ||
          entry.hook?.legacyCheckout ||
          (linked &&
            HARNESSES[entry.harness].integration.skill !== "native" &&
            entry.status === "installed"),
      )
      .map((entry) => entry.harness);
    if (!harnesses.length) return [];
    return [
      `degreaser-axi setup hooks --harnesses ${harnesses.join(",")}${linked ? " --skill-install link" : ""}${scope === "user" ? " --installation-scope user" : ""}`,
    ];
  });
  return {
    output: {
      ...(config
        ? configNotice(config, ASPECT_IDS)
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
    },
    ...(blocked ? { exitCode: 2 } : {}),
  };
}
