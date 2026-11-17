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
import { recommend, recommendVerifier, sameIdentity } from "./recommend.ts";

const agents = AGENTS;
const metadataNotice =
  "Native catalogs are metadata, not a guarantee of later provider availability. Account identity is not exposed by discovery; credentials remain in the harness.";

export interface Requested {
  agent?: Agent | undefined;
  model?: string | undefined;
  verifierAgent?: Agent | undefined;
  verifierModel?: string | undefined;
  harnesses?: Agent[] | undefined;
}

export function resolvedVerifier({
  agent,
  model,
  verifierAgent,
  verifierModel,
}: Requested): Identity | undefined {
  const owner = verifierAgent ?? agent;
  const selectedModel = verifierModel ?? (!verifierAgent ? model : undefined);
  return owner && selectedModel
    ? { agent: owner, model: selectedModel }
    : undefined;
}

function suggestedVerifier(
  choices: Catalog,
  previous: ProjectConfig | undefined,
  requested: Requested,
  worker: Identity | null,
) {
  const explicit =
    (requested.verifierAgent || requested.verifierModel) &&
    resolvedVerifier(requested);
  if (explicit) return explicit;
  const owner = requested.verifierAgent ?? requested.agent ?? worker?.agent;
  const matches = (candidate: Identity) =>
    (!owner || candidate.agent === owner) &&
    (!requested.verifierModel || candidate.model === requested.verifierModel);
  const compatible = choices.candidates.filter(matches);
  const before = previous?.verifier && {
    agent: previous.verifier.agent ?? previous.agent,
    model: previous.verifier.model,
  };
  const suggested =
    (before && matches(before) ? before : undefined) ??
    recommendVerifier(compatible) ??
    compatible[0];
  return suggested ? { agent: suggested.agent, model: suggested.model } : null;
}

export function decisionRequired(
  choices: Catalog,
  previous: ProjectConfig | undefined,
  requested: Requested,
  scope: InstallationScope,
) {
  const { agent, model, harnesses } = requested;
  const identity = agent && model ? { agent, model } : undefined;
  const matchesFlags = (candidate: Identity) =>
    (!agent || candidate.agent === agent) &&
    (!model || candidate.model === model);
  const compatible = choices.candidates.filter(matchesFlags);
  const best = recommend(compatible) ?? compatible[0];
  const prefill =
    identity ?? (previous && matchesFlags(previous) ? previous : best) ?? null;
  const verifierPrefill = suggestedVerifier(
    choices,
    previous,
    requested,
    prefill,
  );
  const missing = [
    ...(!agent || !model ? ["model"] : []),
    ...((requested.verifierAgent || requested.verifierModel) &&
    !resolvedVerifier(requested)
      ? ["verifier-model"]
      : []),
    ...(!harnesses ? ["harnesses"] : []),
  ];
  if (missing.length) {
    const example =
      compatible.find((c) => prefill && sameIdentity(c, prefill)) ?? best;
    const verifierFlags = verifierPrefill
      ? [
          ...(verifierPrefill.agent !== example?.agent
            ? [`--verifier-agent ${verifierPrefill.agent}`]
            : []),
          `--verifier-model ${shellQuote(verifierPrefill.model)}`,
        ].join(" ")
      : "";
    const commands = (example ? [example] : []).flatMap((c) =>
      (harnesses ? [harnesses.join(",")] : agents).map((target) =>
        [
          "degreaser-axi init",
          `--agent ${c.agent}`,
          `--model ${shellQuote(c.model)}`,
          verifierFlags,
          `--harnesses ${target}`,
          `--installation-scope ${scope}`,
        ]
          .filter(Boolean)
          .join(" "),
      ),
    );
    return {
      code: "decision-required",
      error:
        "Ask the user to confirm or change the finder model and harness selection, then rerun with explicit flags. A separate verifier is optional; omit both verifier flags to use the finder model. Existing RC and recommendations are only prefill. No product files were written.",
      missing,
      ...choices,
      prefill: prefill ? { agent: prefill.agent, model: prefill.model } : null,
      verifierPrefill,
      harnesses: agents,
      installationScope: scope,
      notice: metadataNotice,
      actions:
        "Commands below are choices to show the user, not authorization to select for them. Use a listed model ID or latest selector; combine confirmed harnesses with commas. The suggested separate verifier uses the strongest listed model; omit both verifier flags to use the finder model. A separate verifier needs --verifier-agent only when it differs from --agent.",
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
  verifier: Identity,
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
    verifier,
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
