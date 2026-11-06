import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AxiError, runAxiCli } from "axi-sdk-js";
import {
  COMMANDS,
  type Command,
  commandHelp,
  TOP_LEVEL_HELP,
} from "./commands.js";
import { configNotice, loadConfig } from "./config.ts";
import { syncConfig } from "./config-sync.ts";
import { diagnoseFailure } from "./diagnostics.ts";
import { doctor } from "./doctor.ts";
import { repositoryRoot } from "./git.ts";
import { CALLER_GUIDANCE, DESCRIPTION } from "./guidance.js";
import { init } from "./init.ts";
import { InputError } from "./input-error.ts";
import { setupIntegrations } from "./integrations.ts";
import { observedStatus } from "./report.ts";
import {
  cancel,
  dismissCommand,
  readCommand,
  resume,
  review,
} from "./review.ts";
import { loadInput, loadRun, StateError } from "./storage.ts";
import { VERSION } from "./version.js";

function parseCommand(name: string, command: Command, args: string[]) {
  const suggestions = [
    `Usage: degreaser-axi ${command.usage}`,
    `Valid flags: ${[...Object.keys(command.flags).map((flag) => `--${flag}`), "--help"].join(", ")}`,
  ];
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: { ...command.flags, help: { type: "boolean" } },
    });
  } catch (error) {
    throw new AxiError(
      `${name}: ${error instanceof Error ? error.message : "Invalid arguments"}`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  if (parsed.positionals.length > command.positionals.max) {
    throw new AxiError(
      `${name}: unexpected argument ${parsed.positionals[command.positionals.max]}`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  if (
    !parsed.values.help &&
    parsed.positionals.length < command.positionals.min
  ) {
    throw new AxiError(
      `${name}: missing required argument`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
  return parsed;
}

function home() {
  const bin = process.argv[1] ?? "";
  const local: Record<string, unknown> = {
    bin: bin.startsWith(`${homedir()}/`)
      ? `~${bin.slice(homedir().length)}`
      : bin,
    description: DESCRIPTION,
    configuration: "unconfigured",
    history: "unavailable",
    status: "unconfigured",
    commands: Object.keys(COMMANDS),
    guidance: CALLER_GUIDANCE,
    help: ["degreaser-axi review --help", "degreaser-axi init --help"],
  };
  let repository: string;
  try {
    repository = repositoryRoot(process.cwd());
  } catch {
    return { ...local, reason: "Local repository context is unavailable." };
  }
  try {
    const config = loadConfig(repository);
    Object.assign(local, {
      ...configNotice(config),
      configuration: "configured",
      status: "configured",
      agent: config.agent,
      model: config.model,
    });
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    if (existsSync(join(repository, ".degreaserrc.json"))) {
      process.exitCode = 2;
      local.configuration = "invalid";
    }
    local.reason = error.message;
  }
  try {
    const run = loadRun(repository);
    loadInput(run);
    const status = observedStatus(run);
    Object.assign(local, {
      history: "available",
      run: run.id,
      status,
      next: `degreaser-axi ${status === "running" ? "wait" : "report"} ${run.id}`,
      help: [
        `degreaser-axi ${status === "running" ? "wait" : "report"} ${run.id}`,
        "degreaser-axi review --help",
      ],
    });
  } catch (error) {
    if (!(error instanceof StateError || error instanceof InputError))
      throw error;
    if (error.code !== "no-history") process.exitCode = 2;
    local.history = error.code;
    local.historyReason = error.message;
  }
  return local;
}

async function execute(
  name: string,
  command: Command,
  args: string[],
): Promise<string | Record<string, unknown>> {
  if (name === "config" && args[0] === "sync") {
    const sync = COMMANDS["config sync"];
    if (!sync) throw new Error("Missing config sync command");
    return execute("config sync", sync, args.slice(1));
  }
  if (name === "setup" && args[0] === "hooks") {
    const hooks = COMMANDS["setup hooks"];
    if (!hooks) throw new Error("Missing hooks command");
    return execute("setup hooks", hooks, args.slice(1));
  }
  const parsed = parseCommand(name, command, args);
  if (name === "setup" && parsed.positionals.length > 0) {
    throw new AxiError(
      `Unknown setup command: ${parsed.positionals[0]}`,
      "VALIDATION_ERROR",
      ["degreaser-axi setup hooks --help"],
    );
  }
  if (parsed.values.help)
    return {
      ...commandHelp(name, command),
      ...(name === "home" ? { commands: Object.keys(COMMANDS) } : {}),
    };
  if (name === "config")
    throw new AxiError(
      `Unknown config command: ${parsed.positionals[0]}`,
      "VALIDATION_ERROR",
      ["degreaser-axi config sync --help"],
    );
  if (name === "config sync") return syncConfig(process.cwd());
  if (name === "help") {
    const target = parsed.positionals.join(" ");
    if (!target) return TOP_LEVEL_HELP.trimEnd();
    const targetCommand = Object.hasOwn(COMMANDS, target)
      ? COMMANDS[target]
      : undefined;
    if (targetCommand) return commandHelp(target, targetCommand);
    throw new AxiError(`Unknown command: ${target}`, "VALIDATION_ERROR", [
      TOP_LEVEL_HELP,
    ]);
  }
  if (name === "version") return VERSION;
  if (name === "home") return home();
  if (name === "init") return init(parsed.values, process.cwd());
  if (name === "setup hooks")
    return setupIntegrations(parsed.values, process.cwd());
  if (name === "doctor") return doctor(process.cwd());
  if (name === "review") return review(args, process.cwd());
  if (name === "cancel") return cancel(parsed.positionals[0], process.cwd());
  if (name === "resume")
    return resume(parsed.positionals[0] ?? "", parsed.values, process.cwd());
  if (name === "dismiss")
    return dismissCommand(parsed.positionals, parsed.values, process.cwd());
  if (["wait", "report", "export", "finding"].includes(name))
    return readCommand(name, parsed.positionals, parsed.values, process.cwd());
  process.exitCode = 2;
  return {
    error: "environment-blocked",
    reason:
      name === "update"
        ? "This package is not published. Registry self-update is disabled."
        : `${name} is not implemented in this development build. No work started.`,
    help: [`degreaser-axi ${name} --help`],
  };
}

async function withDiagnostics(
  name: string,
  action: () =>
    | string
    | Record<string, unknown>
    | Promise<string | Record<string, unknown>>,
) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof InputError || error instanceof StateError) {
      process.exitCode = 2;
      return {
        error: error.code,
        reason: error.message,
        help: [`degreaser-axi ${name} --help`],
      };
    }
    if (error instanceof AxiError) {
      process.exitCode = 2;
      return {
        error: "invalid-input",
        reason: error.message,
        help: error.suggestions,
      };
    }
    const failure = diagnoseFailure(error, `${name} local operation`);
    process.exitCode = 2;
    return {
      error: failure.code,
      diagnosis: failure.diagnosis,
      reason: failure.message,
      ...failure.details,
      help: failure.help,
    };
  }
}

export async function main(argv: string[]): Promise<void> {
  const commands = Object.fromEntries(
    Object.entries(COMMANDS).map(([name, command]) => [
      name,
      (args: string[]) =>
        withDiagnostics(name, () => execute(name, command, args)),
    ]),
  );
  Object.setPrototypeOf(commands, null);
  await runAxiCli({
    argv,
    version: VERSION,
    description: DESCRIPTION,
    topLevelHelp: TOP_LEVEL_HELP,
    home: () => withDiagnostics("home", home),
    commands,
    renderUnknownCommand: (command) =>
      `error: invalid-input\nreason: ${JSON.stringify(`Unknown command: ${command}`)}\nhelp: ${JSON.stringify(`Valid commands: ${Object.keys(COMMANDS).join(", ")}. Run degreaser-axi --help.`)}\n`,
  });
}
