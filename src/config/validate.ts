import { InputError } from "../util/errors.ts";
import { schema } from "../util/schema.ts";
import type { ProjectConfig } from "./types.ts";

const LEGACY_ASPECT_KEYS = ["enable", "disable", "overrides"];

export function validateConfig(data: unknown): ProjectConfig {
  const aspects = (data as { aspects?: unknown } | null)?.aspects;
  if (
    aspects &&
    typeof aspects === "object" &&
    LEGACY_ASPECT_KEYS.some((key) => Object.hasOwn(aspects, key))
  )
    throw new InputError(
      '.degreaserrc.json: aspects.enable/disable/overrides were replaced by one entry per aspect, e.g. "aspects": { "scope-creep": false, "low-value-comments": { "model": "<model>" } }. Omitted aspects are on.',
    );
  const validate = schema<ProjectConfig>(
    new URL("./config.schema.json", import.meta.url),
  );
  if (!validate(data)) {
    const details = validate.errors
      ?.map((error) => `${error.schemaPath} ${error.message}`)
      .join("; ");
    throw new InputError(`.degreaserrc.json: ${details}`);
  }
  return data;
}
