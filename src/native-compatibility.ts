import type { Agent } from "./config.ts";
import { DiagnosticError } from "./diagnostics.ts";

/** Versions the isolation flags were verified against. */
export const SUPPORTED_NATIVE_VERSIONS: Record<Agent, string> = {
  codex: "0.165.0",
  claude: "2.1.317",
  pi: "1.4.0",
  cursor: "2026.11.05-86047df",
};

/** Codex ships inside this package; the others auto-update on the host. */
const EXACT: Record<Agent, boolean> = {
  codex: true,
  claude: false,
  pi: false,
  cursor: false,
};

/** Human-readable acceptance rule, shared by doctor output and diagnostics. */
export function acceptedNativeVersions(agent: Agent): string {
  const verified = SUPPORTED_NATIVE_VERSIONS[agent];
  if (EXACT[agent]) return `${verified} (exact)`;
  if (agent === "cursor") return `${verified} or a later release date`;
  return `${verified} or newer ${verified.split(".")[0]}.x`;
}

function numbers(version: string): number[] {
  return version.replace(/-.*$/, "").split(".").map(Number);
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export function assertNativeVersion(
  agent: Agent,
  observed: string,
): { version: string; notice?: string } {
  const supported = SUPPORTED_NATIVE_VERSIONS[agent];
  // Only a version token is safe diagnostic data, never arbitrary process output.
  const version = (agent === "cursor"
    ? /^20\d{2}\.\d{1,2}\.\d{1,2}-[0-9a-f]{7,40}$/i
    : /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
  ).test(observed)
    ? observed
    : "unrecognized";
  const parsed = version === "unrecognized" ? undefined : numbers(version);
  const base = numbers(supported);
  const order = parsed ? compare(parsed, base) : -1;
  const accepted = EXACT[agent]
    ? version === supported
    : parsed !== undefined &&
      order >= 0 &&
      (agent === "cursor" || parsed[0] === base[0]);
  if (!accepted)
    throw new DiagnosticError(
      "unsupported-native-version",
      `Unsupported ${agent} native version: observed ${version}; ${EXACT[agent] ? "supported" : "minimum"} ${supported}${EXACT[agent] || agent === "cursor" ? "" : ` within major ${base[0]}`}. Unverified versions are refused before dispatch.`,
      [
        EXACT[agent]
          ? `Restore the pinned Degreaser package with bundled Codex ${supported}, or use a Degreaser release revalidated for the observed version. No host update or model switch was performed.`
          : `Point PATH at an already installed ${agent} ${acceptedNativeVersions(agent)}, or use a Degreaser release revalidated for ${version}. Do not silently update or downgrade the global CLI or switch models.`,
      ],
      {
        agent,
        observedNativeVersion: version,
        supportedNativeVersion: supported,
      },
    );
  return version !== supported
    ? {
        version,
        notice: `Unverified newer ${agent} native version ${version} (verified ${supported}); proceeding. Report regressions or use a revalidated Degreaser release.`,
      }
    : { version };
}
