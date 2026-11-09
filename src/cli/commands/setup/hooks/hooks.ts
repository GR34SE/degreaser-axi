import { ensureStateIgnored } from "../../../../install/gitignore.ts";
import { prepareIntegrations } from "../../../../install/plan.ts";
import {
  installationChoices,
  skillInstallChoice,
} from "../../../../install/targets.ts";
import { assertNotWorker } from "../../../../modules/harness/common/isolation.ts";
import { repositoryRoot } from "../../../../util/git/repository.ts";
import type { Factory } from "../../../factory.ts";
import type { CommandOptions } from "../../../types.ts";

export { spec } from "./spec.ts";

export function run(f: Factory, { values }: CommandOptions) {
  const { cwd, env } = f;
  assertNotWorker(env, "install Degreaser integrations");
  const { harnesses, scope } = installationChoices(values);
  const repository = scope === "project" ? repositoryRoot(f, cwd) : f.home;
  const plan = prepareIntegrations(f, repository, harnesses, scope, {
    remove: values.remove === true,
    skillInstall: skillInstallChoice(values),
  });
  if (scope === "project" && !values.remove) ensureStateIgnored(f, repository);
  plan.apply();
  return {
    output: {
      status: values.remove ? "removed" : "installed",
      installationScope: scope,
      integrations: plan.results,
    },
  };
}
