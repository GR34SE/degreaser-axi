import type { Agent } from "./config.ts";
import { DiagnosticError } from "./diagnostics.ts";

export const SUPPORTED_NATIVE_VERSIONS: Record<Agent, string> = {
  codex: "0.165.0",
  claude: "2.1.317",
  pi: "1.4.0",
};

export function assertNativeVersion(agent: Agent, observed: string): string {
  const supported = SUPPORTED_NATIVE_VERSIONS[agent];
  // Only a version token is safe diagnostic data, never arbitrary process output.
  const version = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(observed)
    ? observed
    : "unrecognized";
  if (version !== supported)
    throw new DiagnosticError(
      "unsupported-native-version",
      `Unsupported ${agent} native version: observed ${version}; supported ${supported}. Unverified versions are refused before dispatch.`,
      [
        agent === "codex"
          ? `Restore the pinned Degreaser package with bundled Codex ${supported}, or use a Degreaser release revalidated for the observed version. No host update or model switch was performed.`
          : `Point PATH at an already installed, verified ${agent} ${supported}, or use a Degreaser release revalidated for ${version}. Do not silently update or downgrade the global CLI or switch models.`,
      ],
      {
        agent,
        observedNativeVersion: version,
        supportedNativeVersion: supported,
      },
    );
  return version;
}
