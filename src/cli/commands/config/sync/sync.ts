import { ASPECT_IDS } from "../../../../modules/aspect/api.ts";
import type { Factory } from "../../../factory.ts";

export { spec } from "./spec.ts";

import { join } from "node:path";
import {
  completeConfig,
  missingConfigFields,
} from "../../../../config/defaults.ts";
import { readConfigText } from "../../../../config/load.ts";
import { resolveConfig } from "../../../../config/resolve.ts";
import { validateConfig } from "../../../../config/validate.ts";
import { assertNotWorker } from "../../../../modules/harness/common/isolation.ts";
import { InputError, StateError } from "../../../../util/errors.ts";
import { atomicWrite } from "../../../../util/fs/atomic.ts";
import { repositoryRoot } from "../../../../util/git/repository.ts";
import { json } from "../../../../util/json.ts";

export function run(f: Factory) {
  const { cwd, env } = f;
  assertNotWorker(env, "synchronize configuration");
  const path = join(repositoryRoot(f, cwd), ".degreaserrc.json");
  const before = readConfigText(path);
  if (before === null)
    throw new InputError(
      "Root .degreaserrc.json must exist. Run degreaser-axi init first.",
    );
  let data: unknown;
  try {
    data = JSON.parse(before);
  } catch {
    throw new InputError(
      "Root .degreaserrc.json must contain valid JSON. No configuration was changed.",
    );
  }
  const previous = validateConfig(data);
  const config = completeConfig(previous, ASPECT_IDS);
  resolveConfig(config, {}, ASPECT_IDS);
  const added = missingConfigFields(previous, ASPECT_IDS);
  if (added.length) {
    if (readConfigText(path) !== before)
      throw new StateError(
        "input-changed",
        ".degreaserrc.json changed during sync. Rerun degreaser-axi config sync.",
      );
    atomicWrite(path, json(config));
  }
  return {
    output: {
      status: added.length ? "synchronized" : "unchanged",
      file: path,
      added,
    },
  };
}
