import { join } from "node:path";
import {
  completeConfig,
  missingConfigFields,
  readConfigText,
  resolveConfig,
  validateConfig,
} from "./config.ts";
import { repositoryRoot } from "./git.ts";
import { InputError } from "./input-error.ts";
import { assertNotWorker } from "./native-environment.ts";
import { atomicWrite, StateError } from "./storage.ts";

export function syncConfig(cwd: string) {
  assertNotWorker("synchronize configuration");
  const path = join(repositoryRoot(cwd), ".degreaserrc.json");
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
  const config = completeConfig(previous);
  resolveConfig(config);
  const added = missingConfigFields(previous);
  if (added.length) {
    if (readConfigText(path) !== before)
      throw new StateError(
        "input-changed",
        ".degreaserrc.json changed during sync. Rerun degreaser-axi config sync.",
      );
    atomicWrite(path, `${JSON.stringify(config, null, 2)}\n`);
  }
  return {
    status: added.length ? "synchronized" : "unchanged",
    file: path,
    added,
  };
}
