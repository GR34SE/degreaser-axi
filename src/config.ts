import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { InputError } from "./input-error.ts";

export type Agent = "codex" | "claude" | "pi";
export type AspectId =
  | `A0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `A1${0 | 1 | 2 | 3 | 4 | 5 | 6}`;
export const ASPECT_IDS: readonly AspectId[] = [
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
  "A11",
  "A12",
  "A13",
  "A14",
  "A15",
  "A16",
];
export interface Identity {
  agent: Agent;
  model: string;
}
export interface Assignment extends Identity {
  aspect: AspectId;
}
export interface Limits {
  workerTimeoutSeconds: number;
  maxTurns: number;
  runTimeoutSeconds: number;
}
export interface ProjectConfig extends Identity {
  schemaVersion?: 1;
  concurrency?: number;
  maxRetries?: number;
  limits?: Partial<Limits>;
  aspects?: {
    enable?: AspectId[];
    disable?: AspectId[];
    overrides?: Partial<Record<AspectId, { agent?: Agent; model: string }>>;
  };
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

export function loadConfig(repository: string): ProjectConfig {
  let data: unknown;
  try {
    data = JSON.parse(
      readFileSync(join(repository, ".degreaserrc.json"), "utf8"),
    );
  } catch {
    throw new InputError(
      "Root .degreaserrc.json must exist and contain readable JSON. Configure an explicit agent and model.",
    );
  }
  return validateConfig(data);
}

export function validateConfig(data: unknown): ProjectConfig {
  if (!validate(data)) {
    const details = validate.errors
      ?.map((error) => {
        const property =
          error.params.additionalProperty ?? error.params.missingProperty;
        return `config${error.instancePath}${typeof property === "string" ? `/${property}` : ""} ${error.message}`;
      })
      .join("; ");
    throw new InputError(`.degreaserrc.json: ${details}`);
  }
  return data;
}

export function resolveConfig(
  data: unknown,
  controls: ReviewControls = {},
): EffectiveConfig {
  const rc = validateConfig(data);
  const disabled = new Set(rc.aspects?.disable ?? []);
  if (rc.aspects?.enable?.some((id) => disabled.has(id))) {
    throw new InputError("An aspect cannot appear in both enable and disable.");
  }
  const enabled = ASPECT_IDS.filter((id) => !disabled.has(id));
  if (enabled.length === 0 || controls.aspects?.length === 0)
    throw new InputError("The effective aspect selection is empty.");
  if (controls.aspects) {
    if (new Set(controls.aspects).size !== controls.aspects.length)
      throw new InputError("Duplicate aspect IDs are invalid.");
    for (const id of controls.aspects) {
      if (!ASPECT_IDS.some((known) => known === id))
        throw new InputError(`Unknown aspect ID: ${id}. Use A01-A16.`);
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
    const override = rc.aspects?.overrides?.[id];
    if (
      (override?.agent ?? rc.agent) === "pi" &&
      !/^[^/\s]+\/\S+$/.test(override?.model ?? rc.model)
    ) {
      throw new InputError(`${id}: Pi requires a provider-qualified model ID.`);
    }
  }
  return {
    assignments: enabled
      .filter((id) => !controls.aspects || controls.aspects.includes(id))
      .map((aspect) => ({
        aspect,
        agent: rc.aspects?.overrides?.[aspect]?.agent ?? rc.agent,
        model: rc.aspects?.overrides?.[aspect]?.model ?? rc.model,
      })),
    concurrency: controls.concurrency ?? rc.concurrency ?? null,
    maxRetries: rc.maxRetries ?? 1,
    limits: {
      workerTimeoutSeconds: 300,
      maxTurns: 40,
      runTimeoutSeconds: 900,
      ...rc.limits,
    },
    exclude: [...(rc.exclude ?? [])],
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
