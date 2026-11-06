export interface Flag {
  type: "string" | "boolean";
  multiple?: boolean;
  description: string;
}

export interface Command {
  description: string;
  usage: string;
  flags: Record<string, Flag>;
  positionals: { min: number; max: number };
  examples: string[];
}

const wait: Flag = {
  type: "string",
  description: "Seconds to wait (default 480)",
};
const concurrency: Flag = {
  type: "string",
  description: "Positive active-worker limit (default all enabled aspects)",
};
const installation = {
  harnesses: {
    type: "string",
    description: "Comma-separated codex,claude,pi; explicit selection required",
  },
  "installation-scope": {
    type: "string",
    description: "project (default) or explicit user installation",
  },
  "skill-install": {
    type: "string",
    description:
      "copy (default) or link: Claude's skill as a symlink to the codex/pi .agents/skills copy",
  },
} satisfies Record<string, Flag>;
const noPositionals = { min: 0, max: 0 };
const runId = { min: 1, max: 1 };

export const COMMANDS: Record<string, Command> = {
  home: {
    description: "Show configuration and the latest review",
    usage: "home",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi", "degreaser-axi home"],
  },
  init: {
    description: "Choose the review model and install agent integrations",
    usage: "init --agent <agent> --model <model> --harnesses <targets>",
    flags: {
      agent: {
        type: "string",
        description: "Confirmed worker agent: codex, claude or pi",
      },
      model: {
        type: "string",
        description: "Confirmed exact model ID; required on every init",
      },
      ...installation,
    },
    positionals: noPositionals,
    examples: [
      "degreaser-axi init",
      "degreaser-axi init --agent codex --model <confirmed-model> --harnesses codex",
    ],
  },
  config: {
    description: "Project configuration commands",
    usage: "config sync",
    flags: {},
    positionals: runId,
    examples: ["degreaser-axi config sync", "degreaser-axi config sync --help"],
  },
  "config sync": {
    description: "Save missing default settings without changing existing ones",
    usage: "config sync",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi config sync", "degreaser-axi config sync --help"],
  },
  doctor: {
    description:
      "Check configuration, integrations and native versions without model calls",
    usage: "doctor",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi doctor", "degreaser-axi doctor --help"],
  },
  review: {
    description: "Start a review of an explicit scope and task",
    usage:
      "review --scope <worktree|branch|repository> (--task <text> | --task-file <path>) [--base <ref>] [--path <pattern>]...",
    flags: {
      scope: {
        type: "string",
        description: "Required: worktree, branch or explicit repository audit",
      },
      task: {
        type: "string",
        description:
          "Nonempty task; exactly one of --task and --task-file required",
      },
      "task-file": { type: "string", description: "Read the task from a file" },
      base: {
        type: "string",
        description: "Required explicit base for branch; never inferred",
      },
      path: {
        type: "string",
        multiple: true,
        description:
          "Repeatable; assess only matching files. Git-root-relative directory, file or glob (*, **, ?, [...]); a matched directory includes everything beneath it",
      },
      aspects: {
        type: "string",
        description:
          "Comma-separated aspect IDs, e.g. missed-reuse,scope-creep (default all enabled)",
      },
      concurrency,
      wait,
    },
    positionals: noPositionals,
    examples: [
      'degreaser-axi review --scope worktree --task "Add CSV import"',
      "degreaser-axi review --scope branch --base <given-ref> --task-file <brief>",
      "degreaser-axi review --scope repository --path landing --path 'packages/*/src' --task \"Audit the landing page\"",
    ],
  },
  wait: {
    description: "Wait for a running review to finish",
    usage: "wait <run-id> [--wait <seconds>]",
    flags: { wait },
    positionals: runId,
    examples: [
      "degreaser-axi wait <run-id>",
      "degreaser-axi wait <run-id> --wait 30",
    ],
  },
  report: {
    description: "Show a review's findings and coverage (default: latest run)",
    usage: "report [run-id] [--full]",
    flags: {
      full: {
        type: "boolean",
        description: "Show all findings and full evidence",
      },
    },
    positionals: { min: 0, max: 1 },
    examples: ["degreaser-axi report", "degreaser-axi report <run-id> --full"],
  },
  export: {
    description: "Print a review as JSON for other tools",
    usage: "export [run-id]",
    flags: {},
    positionals: { min: 0, max: 1 },
    examples: [
      "degreaser-axi export > degreaser.json",
      "degreaser-axi export <run-id>",
    ],
  },
  finding: {
    description: "Show one finding with its full evidence",
    usage: "finding <id> [--run <run-id>]",
    flags: {
      run: { type: "string", description: "Run ID (default latest run)" },
    },
    positionals: runId,
    examples: [
      "degreaser-axi finding F1",
      "degreaser-axi finding F1 --run <run-id>",
    ],
  },
  dismiss: {
    description: "Record a finding the user decided not to apply",
    usage: "dismiss <finding-id> --reason <text> [--run <run-id>]",
    flags: {
      reason: {
        type: "string",
        description: "Required: why the user decided not to apply it",
      },
      run: { type: "string", description: "Run ID (default latest run)" },
    },
    positionals: runId,
    examples: [
      'degreaser-axi dismiss F3 --reason "The user keeps this fallback for old clients"',
    ],
  },
  resume: {
    description: "Continue unfinished aspects of an unchanged review",
    usage:
      "resume <run-id> [--concurrency <n>] [--wait <seconds>] [--deadline <seconds>]",
    flags: {
      concurrency,
      wait,
      deadline: {
        type: "string",
        description:
          "Explicit new deadline duration from resume (default retain original)",
      },
    },
    positionals: runId,
    examples: [
      "degreaser-axi resume <run-id>",
      "degreaser-axi resume <run-id> --concurrency 1",
    ],
  },
  cancel: {
    description: "Stop a running review, keeping finished results",
    usage: "cancel <run-id>",
    flags: {},
    positionals: runId,
    examples: ["degreaser-axi cancel <run-id>", "degreaser-axi cancel --help"],
  },
  setup: {
    description: "Agent integration commands",
    usage: "setup hooks [options]",
    flags: {},
    positionals: runId,
    examples: [
      "degreaser-axi setup hooks --help",
      "degreaser-axi setup hooks --harnesses codex",
    ],
  },
  "setup hooks": {
    description: "Install, repair or remove agent integrations",
    usage:
      "setup hooks --harnesses <targets> [--installation-scope project|user] [--remove]",
    flags: {
      ...installation,
      remove: {
        type: "boolean",
        description: "Remove only Degreaser-owned integration entries",
      },
    },
    positionals: noPositionals,
    examples: [
      "degreaser-axi setup hooks --harnesses claude,pi",
      "degreaser-axi setup hooks --harnesses codex --remove",
    ],
  },
  help: {
    description: "Show help for a command",
    usage: "help [command]",
    flags: {},
    positionals: { min: 0, max: 2 },
    examples: ["degreaser-axi help review", "degreaser-axi help setup hooks"],
  },
  version: {
    description: "Print the version",
    usage: "version",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi --version", "degreaser-axi version"],
  },
};

export function commandHelp(name: string, command: Command) {
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
    .map(([name, command]) => `  ${name}: ${command.description}`),
  "Version: --version, -v, -V",
  "Run degreaser-axi <command> --help for required arguments, flags and defaults.",
  "",
].join("\n");

/** SDK built-ins that runAxiCli lists itself only for a bare --help. */
export const BUILT_IN_HELP =
  "  update: Upgrade to the latest published version (update --check only reports)\n";
