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
} satisfies Record<string, Flag>;
const noPositionals = { min: 0, max: 0 };
const runId = { min: 1, max: 1 };

export const COMMANDS: Record<string, Command> = {
  home: {
    description: "Show local review context without starting work",
    usage: "home",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi", "degreaser-axi home"],
  },
  init: {
    description:
      "Confirm a worker model and install selected native startup integrations and skills",
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
    description: "Maintain the project configuration",
    usage: "config sync",
    flags: {},
    positionals: runId,
    examples: ["degreaser-axi config sync", "degreaser-axi config sync --help"],
  },
  "config sync": {
    description:
      "Fill missing RC settings with installed defaults, preserving existing values",
    usage: "config sync",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi config sync", "degreaser-axi config sync --help"],
  },
  doctor: {
    description:
      "Inspect configuration and integration readiness without model calls",
    usage: "doctor",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi doctor", "degreaser-axi doctor --help"],
  },
  review: {
    description:
      "Review an explicit scope and task with fresh source-only reviewers",
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
        description: "Comma-separated A01-A16 subset (default all enabled)",
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
    description:
      "Wait for the same background run without restarting reviewers",
    usage: "wait <run-id> [--wait <seconds>]",
    flags: { wait },
    positionals: runId,
    examples: [
      "degreaser-axi wait <run-id>",
      "degreaser-axi wait <run-id> --wait 30",
    ],
  },
  report: {
    description:
      "Read a local run (default latest); at most 30 finding rows unless --full",
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
  finding: {
    description: "Show a finding's full source evidence",
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
  resume: {
    description:
      "Continue unresolved aspects of unchanged input, retaining successful results",
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
    description:
      "Stop an active run's owned workers and retain resolved results",
    usage: "cancel <run-id>",
    flags: {},
    positionals: runId,
    examples: ["degreaser-axi cancel <run-id>", "degreaser-axi cancel --help"],
  },
  setup: {
    description: "Manage the selected harness startup integrations",
    usage: "setup hooks [options]",
    flags: {},
    positionals: runId,
    examples: [
      "degreaser-axi setup hooks --help",
      "degreaser-axi setup hooks --harnesses codex",
    ],
  },
  "setup hooks": {
    description:
      "Install, repair or remove owned startup integrations and skill",
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
    description: "Show top-level or command-local help",
    usage: "help [command]",
    flags: {},
    positionals: { min: 0, max: 2 },
    examples: ["degreaser-axi help review", "degreaser-axi help setup hooks"],
  },
  version: {
    description:
      "Print the package version without repository or authentication",
    usage: "version",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi --version", "degreaser-axi version"],
  },
  update: {
    description: "SDK-reserved; disabled for this unpublished package",
    usage: "update",
    flags: {},
    positionals: noPositionals,
    examples: ["degreaser-axi update --help", "degreaser-axi --version"],
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
  "Development build: review/wait/report/finding/cancel/resume and selected native startup/skill installation are available.",
  "Commands:",
  ...Object.entries(COMMANDS).map(
    ([name, command]) => `  ${name}: ${command.description}`,
  ),
  "Version: --version, -v, -V",
  "Run degreaser-axi <command> --help for required arguments, flags and defaults.",
  "",
].join("\n");
