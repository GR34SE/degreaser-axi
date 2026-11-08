export const DESCRIPTION =
  "Review code changes with focused, read-only reviewers and source evidence.";

export const SKILL_DESCRIPTION =
  "Review a code change with focused source-only reviewers, inspect evidence and choose justified fixes. Use when asked to deslop or degrease. Not for Degreaser workers.";

export const CALLER_GUIDANCE = [
  "Run `degreaser-axi <command>` when it is on PATH, otherwise `npx -y degreaser-axi <command>`. `degreaser-axi review --help` lists every review flag.",
  "The user confirms the review agent, exact model and harnesses on every init; never choose or switch a model for them. Without a terminal, `degreaser-axi init` returns decision-required (exit 2) with candidates and writes nothing: show the choices, then run `degreaser-axi init --agent <agent> --model <exact-id> --harnesses <targets>`.",
  "Pass `--scope worktree`, `branch` or `repository`. `branch` needs the `--base` the user gave you; never guess it. To review part of the code, add repeatable Git-root-relative `--path <dir|file|glob>`; the task text does not narrow files.",
  "Write the task as what the user set out to accomplish, in their terms, not a summary of the diff: their goal, decisions and tradeoffs, approaches they ruled in or out, and anything they asked for that would look surprising in the diff. Reviewers use it to tell a deliberate choice from slop, so a one-line task makes them flag what the user already chose. A few sentences is normal; use `--task-file` for longer briefs. Never invent intent the user did not express.",
  'For example: `degreaser-axi review --scope worktree --task "Add CSV import"`, or for a branch `degreaser-axi review --scope branch --base "$USER_PROVIDED_BASE" --task "Add CSV import"`.',
  "Do not edit code while a review runs. On exit 3 or a tool timeout, run `degreaser-axi wait <run-id>` until a terminal status and start no replacement review. `degreaser-axi report` recovers a lost run ID.",
  "Codex: poll the same command session until it exits. Claude Code: set the Bash timeout to --wait plus 60 seconds (at most 600000 ms); if the command moves to the background, Read its output file and wait for the completion notification (TaskOutput was removed in Claude Code 2.1.277). Pi: use the normal command tool. Cursor: keep the command in the foreground until it exits; if it is backgrounded, wait for its completion notification.",
  "Exit 0: completed or no changes; findings are not failure. Exit 1: partial, failed or interrupted; check coverage. Exit 2: usage, decision or environment error.",
  "Read evidence with `degreaser-axi finding <id>` or `degreaser-axi report --full` and decide fixes yourself; Degreaser never edits code. Not-applicable is not a quality verdict.",
  'When the user decides not to apply a finding, run `degreaser-axi dismiss <id> --reason "<their reason>"` so later reviews of that file skip it. Never dismiss a finding on your own.',
  "`degreaser-axi resume <run-id>` continues unfinished aspects of unchanged input and keeps finished ones; `--deadline <seconds>` starts a new time budget. After editing code, start a new review.",
  "After a rate limit clears, resume with `--concurrency 1`. A disabled account needs access restored with its provider. Never switch account, provider or model.",
  "If the output lists missing settings, review uses the defaults; `degreaser-axi config sync` saves them without changing existing values. `degreaser-axi doctor` checks configuration, integrations and native versions without model calls.",
  "If a sandbox actually denies the command, ask for per-command approval or an authorized terminal. Never change global permissions, install Codex rules or kill review processes yourself.",
  "If DEGREASER_WORKER is set, do not run Degreaser or use this skill.",
];

export const renderSkill = () => `---
name: degreaser
description: ${SKILL_DESCRIPTION}
---

# Degreaser

${DESCRIPTION}

${CALLER_GUIDANCE.map((paragraph) => `- ${paragraph}`).join("\n")}
`;
