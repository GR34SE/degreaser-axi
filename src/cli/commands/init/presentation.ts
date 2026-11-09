import { join, relative } from "node:path";
import type { Agent, Identity, ProjectConfig } from "../../../config/types.ts";
import type { ensureStateIgnored } from "../../../install/gitignore.ts";
import type { prepareIntegrations } from "../../../install/plan.ts";
import type { InstallationScope } from "../../../install/targets.ts";
import { AGENTS, HARNESSES } from "../../../modules/harness/api.ts";
import { git } from "../../../util/git/exec.ts";
import { shellQuote } from "../../../util/shell.ts";
import type { Factory } from "../../factory.ts";
import type { Catalog } from "./catalog.ts";
import { recommend, sameIdentity } from "./recommend.ts";

const agents = AGENTS;
const metadataNotice =
  "Native catalogs are metadata, not a guarantee of later provider availability. Account identity is not exposed by discovery; credentials remain in the harness.";

export function decisionRequired(
  choices: Catalog,
  previous: ProjectConfig | undefined,
  agent: Agent | undefined,
  model: string | undefined,
  harnesses: Agent[] | undefined,
  scope: InstallationScope,
) {
  const identity = agent && model ? { agent, model } : undefined;
  const matchesFlags = (candidate: Identity) =>
    (!agent || candidate.agent === agent) &&
    (!model || candidate.model === model);
  const compatible = choices.candidates.filter(matchesFlags);
  const best = recommend(compatible) ?? compatible[0];
  const prefill =
    identity ?? (previous && matchesFlags(previous) ? previous : best) ?? null;
  const missing = [
    ...(!agent || !model ? ["model"] : []),
    ...(!harnesses ? ["harnesses"] : []),
  ];
  if (missing.length) {
    const example =
      compatible.find((c) => prefill && sameIdentity(c, prefill)) ?? best;
    const commands = (example ? [example] : []).flatMap((c) =>
      (harnesses ? [harnesses.join(",")] : agents).map(
        (target) =>
          `degreaser-axi init --agent ${c.agent} --model ${shellQuote(c.model)} --harnesses ${target} --installation-scope ${scope}`,
      ),
    );
    return {
      code: "decision-required",
      error:
        "Ask the user to confirm or change the model and harness selection, then rerun with explicit flags. Existing RC and recommendations are only prefill. No product files were written.",
      missing,
      ...choices,
      prefill: prefill ? { agent: prefill.agent, model: prefill.model } : null,
      harnesses: agents,
      installationScope: scope,
      notice: metadataNotice,
      actions:
        "Commands below are choices to show the user, not authorization to select for them. Substitute any listed exact agent/model pair; combine confirmed harnesses with commas.",
      help: commands.length ? commands : ["degreaser-axi init"],
    };
  }

  throw new Error("No decision is missing.");
}

export async function installedView(
  f: Factory,
  repository: string,
  path: string,
  integrations: ReturnType<typeof prepareIntegrations>,
  ignore: ReturnType<typeof ensureStateIgnored>,
  identity: Identity,
  harnesses: Agent[],
  scope: InstallationScope,
  choices: Catalog,
) {
  const uncommitted = (
    git(
      f,
      repository,
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ...[path, join(repository, ".gitignore"), ...integrations.files]
          .filter((file) => file.startsWith(`${repository}/`))
          .map((file) => relative(repository, file)),
      ],
      { allowFailure: () => true },
    ) ?? ""
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const commitHint = `Commit ${uncommitted.join(", ")} so new Git worktrees and teammates get this configuration. Init never stages or commits.`;
  if (f.io.interactive) {
    const { log, note, outro } = await import("@clack/prompts");
    const output = { output: f.io.error };
    if (ignore.tracked)
      log.warn(
        "Files in .degreaser/ are already tracked by Git. Review them before sharing.",
        { output: f.io.error },
      );
    const width = Math.max(
      ...harnesses.map((h) => HARNESSES[h].displayName.length),
    );
    note(
      harnesses
        .map(
          (h) =>
            `${HARNESSES[h].displayName.padEnd(width)}  ${HARNESSES[h].integration.invocation}`,
        )
        .join("\n"),
      "Ask for a review in a new session",
      output,
    );
    if (uncommitted.length)
      note(
        uncommitted.sort().join("\n"),
        "Commit these so worktrees and teammates get Degreaser",
        output,
      );
    outro(
      harnesses
        .map((id) => HARNESSES[id].integration.completionNotice)
        .find(Boolean) ?? "Done.",
      output,
    );
    return "";
  }
  return {
    status: "configured",
    agent: identity.agent,
    model: identity.model,
    harnesses,
    installationScope: scope,
    integrations: integrations.results,
    ignore: ignore.changed
      ? "Added /.degreaser/ to root .gitignore."
      : "Shared root ignore already covers .degreaser/.",
    ...(ignore.tracked
      ? {
          warning:
            "State under .degreaser/ is already tracked. The index is unchanged; review tracked files before sharing.",
        }
      : {}),
    ...(uncommitted.length ? { uncommitted } : {}),
    discovery: choices.discovery,
    notice: metadataNotice,
    help: [
      ...(uncommitted.length ? [commitHint] : []),
      "degreaser-axi doctor",
      "degreaser-axi review --help",
    ],
  };
}

export async function confirmReplace(
  f: Factory,
  path: string,
  repository: string,
) {
  const { confirm, isCancel } = await import("@clack/prompts");
  const shown = path.startsWith(`${repository}/`)
    ? relative(repository, path)
    : path;
  const answer = await confirm({
    message: `${shown} differs from this Degreaser version (an older install, another checkout, or your edits). Replace it? Edits in it will be lost.`,
    initialValue: false,
    output: f.io.error,
  });
  return !isCancel(answer) && answer;
}
