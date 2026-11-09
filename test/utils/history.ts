import { loadRun } from "../../src/state/store.ts";
import { StateError } from "../../src/util/errors.ts";

export function latestRun(repository: string) {
  try {
    return loadRun(repository);
  } catch (error) {
    if (error instanceof StateError && error.code === "no-history")
      return undefined;
    throw error;
  }
}
