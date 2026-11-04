import { parseArgs } from "node:util";
import { AxiError, runAxiCli } from "axi-sdk-js";
import {
  COMMANDS,
  type Command,
  commandHelp,
  TOP_LEVEL_HELP,
} from "./commands.js";
import { CALLER_GUIDANCE, DESCRIPTION } from "./guidance.js";
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
  return {
    status: "development",
    reason:
      "Review execution and integrations are not implemented yet; no workers started.",
    commands: Object.keys(COMMANDS),
    guidance: CALLER_GUIDANCE,
    help: ["degreaser-axi review --help", "degreaser-axi init --help"],
  };
}

function execute(
  name: string,
  command: Command,
  args: string[],
): string | Record<string, unknown> {
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

export async function main(argv: string[]): Promise<void> {
  const commands = Object.fromEntries(
    Object.entries(COMMANDS).map(([name, command]) => [
      name,
      (args: string[]) => {
        try {
          return execute(name, command, args);
        } catch (error) {
          if (!(error instanceof AxiError)) throw error;
          process.exitCode = 2;
          return {
            error: "invalid-input",
            reason: error.message,
            help: error.suggestions,
          };
        }
      },
    ]),
  );
  Object.setPrototypeOf(commands, null);
  await runAxiCli({
    argv,
    version: VERSION,
    description: DESCRIPTION,
    topLevelHelp: TOP_LEVEL_HELP,
    home,
    commands,
    renderUnknownCommand: (command) =>
      `error: invalid-input\nreason: ${JSON.stringify(`Unknown command: ${command}`)}\nhelp: ${JSON.stringify(`Valid commands: ${Object.keys(COMMANDS).join(", ")}. Run degreaser-axi --help.`)}\n`,
  });
}
