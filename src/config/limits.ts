import { DEFAULT_LIMITS, DEFAULT_SESSIONS_PER_ASPECT } from "./defaults.ts";
import type { Limits, ProjectConfig } from "./types.ts";

export function lowerConfiguredLimits(rc: ProjectConfig, aspects: number) {
  const below: { field: string; value: number; default: number }[] = [];
  const add = (field: string, value: number | undefined, normal: number) => {
    if (value !== undefined && value < normal)
      below.push({ field, value, default: normal });
  };
  add("concurrency", rc.concurrency, DEFAULT_SESSIONS_PER_ASPECT * aspects);
  for (const [key, value] of Object.entries(DEFAULT_LIMITS))
    add(`limits.${key}`, rc.limits?.[key as keyof Limits], value);
  return below;
}
