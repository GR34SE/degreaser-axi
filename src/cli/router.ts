import { RESERVED_COMMANDS, runAxiCli } from "axi-sdk-js";
import { DESCRIPTION } from "../install/skill/guidance.ts";
import { VERSION } from "../version.ts";
import { commandFailure } from "./errors.ts";
import { setExitCode } from "./exit-codes.ts";
import { createFactory, type Factory } from "./factory.ts";
import { parseCommand } from "./parse.ts";
import {
  BUILT_IN_HELP,
  COMMANDS,
  commandHelp,
  TOP_LEVEL_HELP,
} from "./registry.ts";

export async function main(argv: string[], provided?: Factory): Promise<void> {
  const f = provided ?? createFactory();
  f.commandNames = [...Object.keys(COMMANDS), ...RESERVED_COMMANDS];
  f.help = (target) => {
    if (!target) return `${TOP_LEVEL_HELP}${BUILT_IN_HELP}`.trimEnd();
    const command = Object.hasOwn(COMMANDS, target)
      ? COMMANDS[target]
      : undefined;
    if (!command) throw new Error(`Unknown command: ${target}`);
    return commandHelp(target, command.spec);
  };
  let exitCode: number | undefined;
  const execute = async (name: string, args: string[]) => {
    const nested = `${name} ${args[0] ?? ""}`;
    if (Object.hasOwn(COMMANDS, nested)) return execute(nested, args.slice(1));
    try {
      const command = COMMANDS[name];
      if (!command) throw new Error("Missing command declaration.");
      const options = parseCommand(name, command.spec, args);
      const unknownSubcommand =
        options.positionals.length > 0 &&
        Object.keys(COMMANDS).some((key) => key.startsWith(`${name} `));
      if (options.values.help && !unknownSubcommand)
        return {
          ...commandHelp(name, command.spec),
          ...(name === "home" ? { commands: f.commandNames } : {}),
        };
      const result = await command.run(f, options);
      exitCode = result.exitCode;
      return result.output;
    } catch (error) {
      exitCode = 2;
      return commandFailure(error, name);
    }
  };
  const commands = Object.fromEntries(
    Object.keys(COMMANDS).map((name) => [
      name,
      (args: string[]) => execute(name, args),
    ]),
  );
  Object.setPrototypeOf(commands, null);
  await runAxiCli({
    argv,
    version: VERSION,
    description: DESCRIPTION,
    topLevelHelp: TOP_LEVEL_HELP,
    stdout: f.io.output,
    home: () => execute("home", []),
    commands,
    renderUnknownCommand: (command) =>
      `error: ${JSON.stringify(`Unknown command: ${command}`)}\ncode: VALIDATION_ERROR\nhelp: ${JSON.stringify(`Valid commands: ${f.commandNames.join(", ")}. Run degreaser-axi --help.`)}\n`,
  });
  if (exitCode !== undefined) setExitCode(exitCode);
}
