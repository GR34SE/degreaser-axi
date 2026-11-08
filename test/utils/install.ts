import { createFactory } from "../../src/cli/factory.ts";
import { inspectIntegrations as inspect } from "../../src/install/inspect.ts";
import { prepareIntegrations as prepare } from "../../src/install/plan.ts";

export const prepareIntegrations = (
  ...args: Parameters<typeof prepare> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => prepare(createFactory(), ...args);
export const inspectIntegrations = (repository: string) =>
  inspect(createFactory(), repository);
