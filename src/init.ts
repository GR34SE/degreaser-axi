import { join } from "node:path";
import { createInterface } from "node:readline/promises";
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
import { repositoryRoot } from "./git.ts";
import { ensureStateIgnored } from "./init-ignore.ts";
import { InputError } from "./input-error.ts";
import { prepareIntegrations } from "./integrations.ts";
import { discoverModels } from "./model-discovery.ts";
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

async function catalog(cwd: string) {
  const candidates: Candidate[] = [];
  const discovery: { agent: Agent; status: string; reason: string }[] = [];
  // Native probes share subscription resources; each joins before the next.
  for (const agent of agents) {
    try {
      const models = await discoverModels({ agent }, cwd);
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

async function confirm(
  candidates: Candidate[],
  prefill: Identity | null,
  harnesses: Agent[],
): Promise<{ identity: Identity; harnesses: Agent[] }> {
  process.stderr.write(`${metadataNotice}\n`);
  for (const [index, c] of candidates.entries())
    process.stderr.write(`${index + 1}. ${c.agent}/${c.model}, ${c.account}\n`);
  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const closed = new AbortController();
  terminal.once("close", () => closed.abort());
  terminal.once("SIGINT", () => terminal.close());
  try {
    const answer = await terminal.question(
      `Confirm model${prefill ? ` [${prefill.agent}/${prefill.model}]` : ""}: Enter to confirm or type a candidate number > `,
      { signal: closed.signal },
    );
    const identity =
      answer.trim() === ""
        ? prefill
        : /^\d+$/.test(answer.trim())
          ? candidates[Number(answer.trim()) - 1]
          : undefined;
    if (!identity)
      throw new InputError(
        "Choose a listed model number. No model was selected automatically.",
      );
    const targets = await terminal.question(
      `Confirm harnesses [${harnesses.join(",")}]: Enter to confirm or type codex,claude,pi targets > `,
      { signal: closed.signal },
    );
    return {
      identity,
      harnesses: harnessChoices(targets.trim() || harnesses.join(",")),
    };
  } catch (error) {
    if (closed.signal.aborted)
      throw new StateError(
        "decision-required",
        "Init was cancelled before confirmation. No files were written. Run degreaser-axi init again.",
      );
    throw error;
  } finally {
    terminal.close();
  }
}

export async function init(
  values: Record<string, unknown>,
  cwd: string,
): Promise<Record<string, unknown>> {
  if (process.env.DEGREASER_WORKER)
    throw new StateError(
      "nested-review",
      "Workers cannot initialize Degreaser.",
    );
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
  const scope = values["installation-scope"] ?? "project";
  if (scope !== "project" && scope !== "user")
    throw new InputError("--installation-scope must be project or user.");
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
  const choices = await catalog(repository);
  let identity: Identity | undefined =
    agent && model ? { agent, model } : undefined;
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
  if (process.stdin.isTTY && process.stderr.isTTY) {
    for (const d of choices.discovery)
      process.stderr.write(`${d.agent}: ${d.status}. ${d.reason}\n`);
    if (choices.candidates.length === 0)
      throw new StateError(
        "environment-blocked",
        "No model catalog is available. Repair native harness access and run degreaser-axi init again. No files were written.",
      );
    const selected = await confirm(
      choices.candidates,
      prefill,
      harnesses ??
        choices.discovery
          .filter((d) => d.status === "discovered")
          .map((d) => d.agent),
    );
    identity = selected.identity;
    harnesses = selected.harnesses;
  } else if (missing.length) {
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
      error: "decision-required",
      reason:
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
  const integrations = prepareIntegrations(repository, harnesses, scope);
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
      error: "init-incomplete",
      cause: error.code,
      reason: error.message,
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
    discovery: choices.discovery,
    notice: metadataNotice,
    help: ["degreaser-axi doctor", "degreaser-axi review --help"],
  };
}
