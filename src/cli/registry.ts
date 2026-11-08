import * as cancel from "./commands/cancel/cancel.ts";
import * as config from "./commands/config/config.ts";
import * as sync from "./commands/config/sync/sync.ts";
import * as dismiss from "./commands/dismiss/dismiss.ts";
import * as doctor from "./commands/doctor/doctor.ts";
import * as exportCommand from "./commands/export/export.ts";
import * as finding from "./commands/finding/finding.ts";
import * as help from "./commands/help/help.ts";
import * as home from "./commands/home/home.ts";
import * as init from "./commands/init/init.ts";
import * as report from "./commands/report/report.ts";
import * as resume from "./commands/resume/resume.ts";
import * as review from "./commands/review/review.ts";
import * as hooks from "./commands/setup/hooks/hooks.ts";
import * as setup from "./commands/setup/setup.ts";
import * as version from "./commands/version/version.ts";
import * as wait from "./commands/wait/wait.ts";
import type { Command, CommandSpec } from "./types.ts";

export const COMMANDS: Record<string, Command> = {
  home,
  init,
  config,
  "config sync": sync,
  doctor,
  review,
  wait,
  report,
  export: exportCommand,
  finding,
  dismiss,
  resume,
  cancel,
  setup,
  "setup hooks": hooks,
  help,
  version,
};

export function commandHelp(name: string, command: CommandSpec) {
  return {
    command: name,
    description: command.description,
    usage: `degreaser-axi ${command.usage}`,
    flags: {
      ...Object.fromEntries(
        Object.entries(command.flags).map(([key, flag]) => [
          `--${key}`,
          flag.description,
        ]),
      ),
      "--help": "Show this command's help",
    },
    examples: command.examples,
  };
}

export const TOP_LEVEL_HELP = [
  "degreaser-axi: focused source-only code review",
  "Commands:",
  ...Object.entries(COMMANDS)
    // Namespaces such as `config` only route to their subcommands.
    .filter(
      ([name]) =>
        !Object.keys(COMMANDS).some((key) => key.startsWith(`${name} `)),
    )
    .map(([name, command]) => `  ${name}: ${command.spec.description}`),
  "Version: --version, -v, -V",
  "Run degreaser-axi <command> --help for required arguments, flags and defaults.",
  "",
].join("\n");

/** SDK built-ins that runAxiCli lists itself only for a bare --help. */
export const BUILT_IN_HELP =
  "  update: Upgrade to the latest published version (update --check only reports)\n";
