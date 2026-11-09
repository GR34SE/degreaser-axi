import { DiagnosticError } from "../../../util/errors.ts";
import type { HarnessDefinition } from "../types.ts";

export function acceptedVersions(definition: HarnessDefinition): string {
  const verified = definition.supportedVersions.verified;
  if (definition.supportedVersions.rule === "exact")
    return `${verified} (exact)`;
  if (definition.supportedVersions.rule === "date")
    return `${verified} or a later release date`;
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

export function assertSupportedVersion(
  definition: HarnessDefinition,
  observed: string,
): { version: string; notice?: string } {
  const agent = definition.id;
  const supported = definition.supportedVersions.verified;
  const version = (definition.supportedVersions.rule === "date"
    ? /^20\d{2}\.\d{1,2}\.\d{1,2}-[0-9a-f]{7,40}$/i
    : /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
  ).test(observed)
    ? observed
    : "unrecognized";
  const parsed = version === "unrecognized" ? undefined : numbers(version);
  const base = numbers(supported);
  const order = parsed ? compare(parsed, base) : -1;
  const accepted =
    definition.supportedVersions.rule === "exact"
      ? version === supported
      : parsed !== undefined &&
        order >= 0 &&
        (definition.supportedVersions.rule === "date" || parsed[0] === base[0]);
  if (!accepted)
    throw new DiagnosticError(
      "unsupported-native-version",
      `Unsupported ${agent} native version: observed ${version}; ${definition.supportedVersions.rule === "exact" ? "supported" : "minimum"} ${supported}${(definition.supportedVersions.rule === "exact") || definition.supportedVersions.rule === "date" ? "" : ` within major ${base[0]}`}. Unverified versions are refused before dispatch.`,
      [
        definition.supportedVersions.rule === "exact"
          ? `Restore the pinned Degreaser package with bundled Codex ${supported}, or use a Degreaser release revalidated for the observed version. No host update or model switch was performed.`
          : `Point PATH at an already installed ${agent} ${acceptedVersions(definition)}, or use a Degreaser release revalidated for ${version}. Do not silently update or downgrade the global CLI or switch models.`,
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
