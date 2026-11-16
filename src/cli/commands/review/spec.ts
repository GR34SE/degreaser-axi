import type { CommandSpec } from "../../types.ts";

export const spec: CommandSpec = {
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
    "task-file": {
      type: "string",
      description: "Read the task from a file",
    },
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
    concurrency: {
      type: "string",
      description:
        "Positive active-worker cap (default the RC value, else one per selected aspect)",
    },
    wait: {
      type: "string",
      description:
        "Return status running after this many seconds (default: block until the run ends, or 60 seconds past its deadline)",
    },
  },
  positionals: {
    min: 0,
    max: 0,
  },
  examples: [
    'degreaser-axi review --scope worktree --task "Add CSV import"',
    "degreaser-axi review --scope branch --base <given-ref> --task-file <brief>",
    "degreaser-axi review --scope repository --path landing --path 'packages/*/src' --task \"Audit the landing page\"",
  ],
};
