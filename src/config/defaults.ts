import type { AspectId } from "../modules/aspect/api.ts";
import type { AspectSetting, ProjectConfig } from "./types.ts";
import { validateConfig } from "./validate.ts";

export function completeConfig(data: unknown, aspectIds: readonly AspectId[]) {
  const rc = validateConfig(data);
  return {
    schemaVersion: 1 as const,
    agent: rc.agent,
    model: rc.model,
    concurrency: rc.concurrency ?? null,
    maxRetries: rc.maxRetries ?? 1,
    limits: {
      workerTimeoutSeconds: 300,
      workerIdleSeconds: 120,
      maxTurns: 40,
      runTimeoutSeconds: 900,
      ...rc.limits,
    },
    aspects: Object.fromEntries(
      aspectIds.map((id): [AspectId, AspectSetting] => [
        id,
        rc.aspects?.[id] ?? true,
      ]),
    ) as Record<AspectId, AspectSetting>,
    exclude: rc.exclude ?? [],
  };
}

export function missingConfigFields(
  rc: ProjectConfig,
  aspectIds: readonly AspectId[],
) {
  const complete = completeConfig(rc, aspectIds);
  const missing: { field: string; value: string }[] = [];
  for (const [field, value] of Object.entries(complete)) {
    if (field === "limits" || field === "aspects") {
      const previous = rc[field] ?? {};
      for (const [key, setting] of Object.entries(complete[field])) {
        if (!Object.hasOwn(previous, key))
          missing.push({
            field: `${field}.${key}`,
            value: JSON.stringify(setting),
          });
      }
    } else if (!Object.hasOwn(rc, field)) {
      missing.push({ field, value: JSON.stringify(value) });
    }
  }
  return missing;
}

export function configNotice(
  rc: ProjectConfig,
  aspectIds: readonly AspectId[],
) {
  const missing = missingConfigFields(rc, aspectIds);
  return missing.length
    ? {
        configurationNotice: {
          reason:
            "Missing settings use the installed defaults shown below. The RC was not changed.",
          missing,
          help: "degreaser-axi config sync",
        },
      }
    : {};
}
