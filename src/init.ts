import { join, relative } from "node:path";
import {
  type Agent,
  completeConfig,
  type Identity,
  type ProjectConfig,
  readConfigText,
  resolveConfig,
  validateConfig,
} from "./config.ts";
import { DiagnosticError } from "./diagnostics.ts";
import { git, repositoryRoot } from "./git.ts";
import { ensureStateIgnored } from "./init-ignore.ts";
import { InputError } from "./input-error.ts";
import { IntegrationConflict } from "./integration-files.ts";
import {
  type InstallationScope,
  skillInstallChoice,
} from "./integration-targets.ts";
import { prepareIntegrations, type SkillInstall } from "./integrations.ts";
import { discoverModels } from "./model-discovery.ts";
import { assertNotWorker } from "./native-environment.ts";
import { atomicWrite, StateError } from "./storage.ts";

const agents: Agent[] = ["codex", "claude", "pi"];
const metadataNotice =
  "Native catalogs are metadata, not a guarantee of later provider availability. Account identity is not exposed by discovery; credentials remain in the harness.";
interface Candidate extends Identity {
  account: string;
}

function agentChoice(value: string): Agent {
  if (value !== "codex" && value !== "claude" && value !== "pi")
    throw new InputError("Choose codex, claude or pi.");
  return value;
}

function harnessChoices(value: string): Agent[] {
  const selected = value.split(",").map((item) => agentChoice(item.trim()));
  if (new Set(selected).size !== selected.length)
    throw new InputError(
      "--harnesses must be a nonempty selection without duplicates.",
    );
  return selected;
}

export type Catalog = Awaited<ReturnType<typeof catalog>>;

async function catalog(
  cwd: string,
  selected: Agent[] = agents,
  signal?: AbortSignal,
) {
  const candidates: Candidate[] = [];
  const discovery: { agent: Agent; status: string; reason: string }[] = [];
  // Native probes share subscription resources; each joins before the next.
  for (const agent of selected) {
    try {
      const models = await discoverModels({ agent }, cwd, 120_000, signal);
      const ids = [...new Set(models.availableModelIds)];
      if (ids.length === 0)
        throw new StateError(
          "environment-blocked",
          `No ${agent} models were advertised.`,
        );
      for (const model of ids)
        candidates.push({
          agent,
          model,
          account:
            agent === "pi"
              ? `Pi native credentials (${model.split("/")[0]}); account identity unavailable`
              : `${agent === "codex" ? "OpenAI" : "Claude"} native subscription; account identity unavailable`,
        });
      discovery.push({
        agent,
        status: "discovered",
        reason: "Native model metadata; no inference.",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof StateError || error instanceof DiagnosticError))
        throw error;
      discovery.push({
        agent,
        status: "unavailable",
        reason:
          error instanceof DiagnosticError
            ? [error.message, ...error.help].join(" ")
            : error.message,
      });
    }
  }
  const recommendation =
    candidates.find(
      (c) =>
        c.model.includes("-") &&
        /(?:^|[-/])(luna|haiku|mini)(?:-|$)/i.test(c.model),
    ) ?? null;
  return { candidates, discovery, recommendation };
}

function sameIdentity(left: Identity, right: Identity) {
  return left.agent === right.agent && left.model === right.model;
}

export async function init(
  values: Record<string, unknown>,
  cwd: string,
): Promise<Record<string, unknown> | string> {
  assertNotWorker("initialize Degreaser");
  const agent =
    values.agent === undefined ? undefined : agentChoice(String(values.agent));
  const model = values.model === undefined ? undefined : String(values.model);
  if (
    model !== undefined &&
    (!model || /[\s\0]/.test(model) || model.startsWith("-"))
  )
    throw new InputError("--model must be an exact nonempty model ID.");
  let harnesses =
    values.harnesses === undefined
      ? undefined
      : harnessChoices(String(values.harnesses));
  const requestedScope = values["installation-scope"] ?? "project";
  if (requestedScope !== "project" && requestedScope !== "user")
    throw new InputError("--installation-scope must be project or user.");
  let scope: InstallationScope = requestedScope;
  const requestedSkillInstall =
    values["skill-install"] === undefined
      ? undefined
      : skillInstallChoice(values);
  let skillInstall: SkillInstall = requestedSkillInstall ?? "copy";
  const repository = repositoryRoot(cwd);
  const path = join(repository, ".degreaserrc.json");
  const before = readConfigText(path);
  let previous: ProjectConfig | undefined;
  if (before !== null) {
    try {
      previous = validateConfig(JSON.parse(before));
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError("Root .degreaserrc.json must contain valid JSON.");
    }
  }
  const tty = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  let choices: Catalog;
  let identity: Identity | undefined =
    agent && model ? { agent, model } : undefined;
  if (tty) {
    const { configureTerminal } = await import("./init-terminal.ts");
    const selected = await configureTerminal(
      {
        agent,
        model,
        previous,
        harnesses,
        scope,
        skillInstall: requestedSkillInstall,
      },
      (selectedAgent, signal) => catalog(repository, [selectedAgent], signal),
    );
    if (!selected) return "";
    identity = selected.identity;
    harnesses = selected.harnesses;
    scope = selected.scope;
    skillInstall = selected.skillInstall;
    choices = selected.choices;
  } else {
    choices = await catalog(repository);
  }
  const matchesFlags = (candidate: Identity) =>
    (!agent || candidate.agent === agent) &&
    (!model || candidate.model === model);
  const compatible = choices.candidates.filter(matchesFlags);
  const prefill =
    identity ??
    [previous, choices.recommendation, ...compatible].find(
      (c) => c && matchesFlags(c),
    ) ??
    null;
  const missing = [
    ...(!agent || !model ? ["model"] : []),
    ...(!harnesses ? ["harnesses"] : []),
  ];
  if (!tty && missing.length) {
    process.exitCode = 2;
    const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const example =
      compatible.find((c) => prefill && sameIdentity(c, prefill)) ??
      compatible.find(
        (c) =>
          choices.recommendation && sameIdentity(c, choices.recommendation),
      ) ??
      compatible[0];
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
  if (!identity || !harnesses)
    throw new InputError("Explicit model and harness decisions are required.");
  if (!choices.candidates.some((c) => sameIdentity(c, identity))) {
    const discovery = choices.discovery.find((d) => d.agent === identity.agent);
    if (discovery?.status === "unavailable")
      throw new StateError("environment-blocked", discovery.reason);
    throw new InputError(
      "Selected agent/model is not available in the adapter's exact model list. No substitute was selected.",
    );
  }
  const config = completeConfig({
    ...previous,
    schemaVersion: 1,
    agent: identity.agent,
    model: identity.model,
  });
  resolveConfig(config);
  if (readConfigText(path) !== before)
    throw new StateError(
      "input-changed",
      ".degreaserrc.json changed during init. Rerun init to confirm the current configuration.",
    );
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const replace = new Set<string>();
  let integrations: ReturnType<typeof prepareIntegrations>;
  for (;;) {
    try {
      integrations = prepareIntegrations(repository, harnesses, scope, {
        skillInstall,
        replace,
      });
      break;
    } catch (error) {
      if (
        !tty ||
        !(error instanceof IntegrationConflict) ||
        !error.replaceable ||
        replace.has(error.path)
      )
        throw error;
      if (!(await confirmReplace(error.path, repository)))
        throw new StateError(
          "decision-required",
          `Kept ${error.path}. Nothing was installed; preserve your edits, then rerun init.`,
        );
      replace.add(error.path);
    }
  }
  const ignore = ensureStateIgnored(repository);
  let installed = false;
  try {
    integrations.apply();
    installed = true;
    if (readConfigText(path) !== before)
      throw new StateError(
        "input-changed",
        ".degreaserrc.json changed during installation; the new content was preserved.",
      );
    if (text !== before) atomicWrite(path, text);
  } catch (error) {
    if (!(error instanceof StateError || error instanceof InputError))
      throw error;
    process.exitCode = 2;
    return {
      error: error.message,
      code: "init-incomplete",
      cause: error.code,
      configuration: "unchanged",
      ignore: "Shared root ignore is in place; the index is unchanged.",
      integrations: installed
        ? integrations.results
        : "Not installed; integration writes were rolled back.",
      help: [
        "Resolve the reported failure, then rerun init with freshly confirmed model and harness choices.",
      ],
    };
  }
  const uncommitted = (
    git(
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
      { allowFailure: true },
    ) ?? ""
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const commitHint = `Commit ${uncommitted.join(", ")} so new Git worktrees and teammates get this configuration. Init never stages or commits.`;
  if (tty) {
    const { log, note, outro } = await import("@clack/prompts");
    const output = { output: process.stderr };
    if (ignore.tracked)
      log.warn(
        "Files in .degreaser/ are already tracked by Git. Review them before sharing.",
        { output: process.stderr },
      );
    const invoke = {
      codex: ["Codex", "$degreaser review my changes"],
      claude: ["Claude Code", "/degreaser review my changes"],
      pi: ["Pi", "/skill:degreaser review my changes"],
    } as const;
    const width = Math.max(...harnesses.map((h) => invoke[h][0].length));
    note(
      harnesses
        .map((h) => `${invoke[h][0].padEnd(width)}  ${invoke[h][1]}`)
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
      harnesses.includes("codex")
        ? "Done. Codex asks you to trust the project and its hook on first start."
        : "Done.",
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

async function confirmReplace(path: string, repository: string) {
  const { confirm, isCancel } = await import("@clack/prompts");
  const shown = path.startsWith(`${repository}/`)
    ? relative(repository, path)
    : path;
  const answer = await confirm({
    message: `${shown} differs from this Degreaser version (an older install, another checkout, or your edits). Replace it? Edits in it will be lost.`,
    initialValue: false,
    output: process.stderr,
  });
  return !isCancel(answer) && answer;
}
