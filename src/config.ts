import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { InputError } from "./input-error.ts";

export type Agent = "codex" | "claude" | "pi";
export const ASPECT_IDS = [
  "missed-reuse",
  "unnecessary-layers",
  "speculative-flexibility",
  "masked-errors",
  "unjustified-defense",
  "low-value-comments",
  "convention-drift",
  "scope-creep",
  "contract-bypass",
  "low-value-tests",
  "incomplete-integration",
  "wrong-abstraction",
  "reinvented-infrastructure",
  "unidiomatic-code",
  "structural-erosion",
  "verification-theater",
] as const;
export type AspectId = (typeof ASPECT_IDS)[number];
export interface Identity {
  agent: Agent;
  model: string;
}
export interface Assignment extends Identity {
  aspect: AspectId;
}
export interface Limits {
  workerTimeoutSeconds: number;
  /** Absent in inputs saved before idle detection; then only the hard limit applies. */
  workerIdleSeconds?: number;
  maxTurns: number;
  runTimeoutSeconds: number;
}
/** true: on with the default identity; false: off; object: on with this identity. */
export type AspectSetting = boolean | { agent?: Agent; model: string };
export interface ProjectConfig extends Identity {
  schemaVersion?: 1;
  concurrency?: number | null;
  maxRetries?: number;
  limits?: Partial<Limits>;
  aspects?: Partial<Record<AspectId, AspectSetting>>;
  exclude?: string[];
}
export interface EffectiveConfig {
  assignments: Assignment[];
  concurrency: number | null;
  maxRetries: number;
  limits: Limits;
  exclude: string[];
}
export interface ReviewControls {
  aspects?: string[];
  concurrency?: number;
}

const schema = JSON.parse(
  readFileSync(
    new URL("../assets/schemas/config-v1.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv({ strict: true, allErrors: true });
const validate = ajv.compile<ProjectConfig>(schema);

export function readConfigText(path: string): string | null {
  try {
    if (!lstatSync(path).isFile())
      throw new InputError(
        "Root .degreaserrc.json must be a regular file, not a symlink.",
      );
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    if (error instanceof InputError) throw error;
    throw new InputError(
      "Root .degreaserrc.json could not be read. No configuration was changed.",
    );
  }
}

export function loadConfig(repository: string): ProjectConfig {
  let data: unknown;
  try {
    data = JSON.parse(
      readFileSync(join(repository, ".degreaserrc.json"), "utf8"),
    );
  } catch {
    throw new InputError(
      "Root .degreaserrc.json must exist and contain readable JSON. Configure an explicit agent and model. In a new Git worktree, commit .degreaserrc.json and .gitignore where init ran, or run init here.",
    );
  }
  return validateConfig(data);
}

const LEGACY_ASPECT_KEYS = ["enable", "disable", "overrides"];

export function validateConfig(data: unknown): ProjectConfig {
  const aspects = (data as { aspects?: unknown } | null)?.aspects;
  if (
    aspects &&
    typeof aspects === "object" &&
    LEGACY_ASPECT_KEYS.some((key) => Object.hasOwn(aspects, key))
  )
    throw new InputError(
      '.degreaserrc.json: aspects.enable/disable/overrides were replaced by one entry per aspect, e.g. "aspects": { "scope-creep": false, "low-value-comments": { "model": "<exact-id>" } }. Omitted aspects are on.',
    );
  if (!validate(data)) {
    const details = validate.errors
      ?.map((error) => `${error.schemaPath} ${error.message}`)
      .join("; ");
    throw new InputError(`.degreaserrc.json: ${details}`);
  }
  return data;
}

export function completeConfig(data: unknown) {
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
      ASPECT_IDS.map((id): [AspectId, AspectSetting] => [
        id,
        rc.aspects?.[id] ?? true,
      ]),
    ) as Record<AspectId, AspectSetting>,
    exclude: rc.exclude ?? [],
  };
}

export function missingConfigFields(rc: ProjectConfig) {
  const complete = completeConfig(rc);
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

export function configNotice(rc: ProjectConfig) {
  const missing = missingConfigFields(rc);
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

export function resolveConfig(
  data: unknown,
  controls: ReviewControls = {},
): EffectiveConfig {
  const rc = completeConfig(data);
  const enabled = ASPECT_IDS.filter((id) => rc.aspects[id] !== false);
  const override = (id: AspectId) => {
    const setting = rc.aspects[id];
    return typeof setting === "object" ? setting : undefined;
  };
  if (enabled.length === 0 || controls.aspects?.length === 0)
    throw new InputError("The effective aspect selection is empty.");
  if (controls.aspects) {
    if (new Set(controls.aspects).size !== controls.aspects.length)
      throw new InputError("Duplicate aspect IDs are invalid.");
    for (const id of controls.aspects) {
      if (!ASPECT_IDS.some((known) => known === id))
        throw new InputError(
          `Unknown aspect ID: ${id}. Use one of: ${ASPECT_IDS.join(", ")}.`,
        );
      if (!enabled.some((known) => known === id))
        throw new InputError(
          `Explicit aspect ${id} is disabled by project configuration.`,
        );
    }
  }
  if (
    controls.concurrency !== undefined &&
    (!Number.isSafeInteger(controls.concurrency) || controls.concurrency <= 0)
  ) {
    throw new InputError("concurrency must be a positive safe integer.");
  }
  // Validate even unused overrides: a narrow invocation must not hide a broken RC.
  for (const id of ASPECT_IDS) {
    if (
      (override(id)?.agent ?? rc.agent) === "pi" &&
      !/^[^/\s]+\/\S+$/.test(override(id)?.model ?? rc.model)
    ) {
      throw new InputError(`${id}: Pi requires a provider-qualified model ID.`);
    }
  }
  return {
    assignments: enabled
      .filter((id) => !controls.aspects || controls.aspects.includes(id))
      .map((aspect) => ({
        aspect,
        agent: override(aspect)?.agent ?? rc.agent,
        model: override(aspect)?.model ?? rc.model,
      })),
    concurrency: controls.concurrency ?? rc.concurrency,
    maxRetries: rc.maxRetries,
    limits: rc.limits,
    exclude: [...rc.exclude],
  };
}

export function assertSupportedModels(
  config: Pick<EffectiveConfig, "assignments">,
  available: readonly Identity[],
): void {
  for (const { aspect, agent, model } of config.assignments) {
    if (
      !available.some(
        (candidate) => candidate.agent === agent && candidate.model === model,
      )
    ) {
      throw new InputError(
        `${aspect}: selected ${agent} model is not available in the adapter's exact model list. No substitute was selected.`,
      );
    }
  }
}
