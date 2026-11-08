import { assertNotWorker } from "../../../modules/harness/common/isolation.ts";
import { findings } from "../../../report/index.ts";
import { recordDismissal } from "../../../state/dismissals.ts";
import { observeRun } from "../../../state/status.ts";
import { loadRun } from "../../../state/store.ts";
import { InputError, StateError } from "../../../util/errors.ts";
import { repositoryRoot } from "../../../util/git/repository.ts";
import type { Factory } from "../../factory.ts";
import type { CommandOptions } from "../../types.ts";

export { spec } from "./spec.ts";

export function run(f: Factory, { positionals, values }: CommandOptions) {
  assertNotWorker(f.env, "dismiss findings; the caller decides");
  const reason = typeof values.reason === "string" ? values.reason.trim() : "";
  if (!reason)
    throw new InputError(
      "--reason is required: say why the finding should not be applied.",
    );
  const repository = repositoryRoot(f, f.cwd);
  const { run, status } = observeRun(
    loadRun(
      repository,
      typeof values.run === "string" ? values.run : undefined,
    ),
  );
  if (status === "running")
    throw new StateError(
      "run-active",
      `${run.id} is still running and its finding IDs can change. Wait for it, then dismiss from the final report.`,
      [`degreaser-axi wait ${run.id}`],
    );
  const id = positionals[0];
  const finding = findings(run).find((finding) => finding.id === id);
  if (!finding)
    throw new StateError(
      "finding-not-found",
      `Finding not found in ${run.id}: ${id}. Use degreaser-axi report ${run.id} --full.`,
    );
  const stored = recordDismissal(f, repository, {
    aspect: finding.aspect,
    path: finding.location.path,
    title: finding.title,
    quote: finding.quote,
    reason,
    dismissedAt: f.now(),
  });
  return {
    output: {
      status: "dismissed",
      finding: id,
      run: run.id,
      stored,
      help: [
        "Later reviews of this file pass the dismissal to its reviewers. Edit or delete the stored file to undo it.",
      ],
    },
  };
}
