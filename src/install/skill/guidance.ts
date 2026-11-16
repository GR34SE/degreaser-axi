export const DESCRIPTION =
  "Review code changes with focused, read-only reviewers and source evidence.";

export const SKILL_DESCRIPTION =
  "Review a code change with focused source-only reviewers, inspect evidence and choose justified fixes. Use when asked to deslop or degrease. Not for Degreaser workers.";

export const CALLER_GUIDANCE = [
  "Run `degreaser-axi <command>` when it is on PATH, otherwise `npx -y degreaser-axi <command>`. `degreaser-axi review --help` lists every review flag.",
  "The user confirms the finder and verifier agent/model and the harnesses on every init; never choose or switch a model for them. Without a terminal, `degreaser-axi init` returns decision-required (exit 2) with candidates and writes nothing: show the choices, then run `degreaser-axi init --agent <agent> --model <model> --verifier-model <model> --harnesses <targets>` (`--verifier-agent` when it differs) with the chosen candidates' `model` values unchanged, whether a version pin or a `(latest)` choice.",
  "Pass `--scope worktree`, `branch` or `repository`. `branch` needs the `--base` the user gave you; never guess it. To review part of the code, add repeatable Git-root-relative `--path <dir|file|glob>`; the task text does not narrow files.",
  "Write the task as what the user set out to accomplish, in their terms, not a summary of the diff: their goal, decisions and tradeoffs, approaches they ruled in or out, and anything they asked for that would look surprising in the diff. Reviewers use it to tell a deliberate choice from slop, so a one-line task makes them flag what the user already chose. A few sentences is normal; use `--task-file` for longer briefs. Never invent intent the user did not express.",
  'For example: `degreaser-axi review --scope worktree --task "Add CSV import"`, or for a branch `degreaser-axi review --scope branch --base "$USER_PROVIDED_BASE" --task "Add CSV import"`.',
  "A review runs one finder and then one verifier per aspect, all aspects in parallel, and can take many minutes. `review` blocks until the run ends; do not pass `--wait` and do not edit code while it runs. Where your harness has a tracked background job with a completion notification, run it there and wait for the notification; otherwise run it in the foreground with the harness's maximum tool timeout. The review runs in its own process, so a tool timeout loses nothing: run `degreaser-axi wait <run-id>` (same blocking behavior) until it ends, and never start a replacement review. `degreaser-axi report` recovers a lost run ID.",
  "Claude Code: run the command with Bash `run_in_background`, wait for the completion notification, then Read its output file. Codex: keep polling the same command session until it exits. Pi: use the normal command tool with its maximum timeout. Cursor: run it in the foreground; if it is backgrounded, wait for its completion notification.",
  "Exit 0: completed or no changes; findings are not failure. Exit 1: partial (an aspect's finder failed, timed out or returned invalid output), failed or interrupted; check coverage. Exit 2: usage, decision or environment error. Exit 3: still running after an explicit `--wait`; run `degreaser-axi wait <run-id>`.",
  'When the run ends, apply every upheld finding, then review the changed files again. Only when the user decides to keep the code, run `degreaser-axi dismiss <id> --reason "<their reason>"` so later reviews of that file skip it. Never dismiss a finding on your own. Refuted findings need no action. Read evidence with `degreaser-axi finding <id>` or `degreaser-axi report --full`; Degreaser never edits code. Not-applicable is not a quality verdict.',
  "Unverified findings are listed after the upheld ones: their verifier did not finish, so they are neither confirmed nor refuted. `degreaser-axi resume <run-id>` reruns only failed aspects and unverified findings of unchanged input and keeps the rest; `--deadline <seconds>` starts a new time budget. After editing code, start a new review.",
  "After a rate limit clears, resume with `--concurrency 1`. A disabled account needs access restored with its provider. Never switch account, provider or model.",
  "Without a configured verifier, the finder agent/model also verifies; `degreaser-axi init` recommends a stronger verifier. If the output lists missing settings, review uses the defaults; `degreaser-axi config sync` saves them without changing existing values. `degreaser-axi doctor` checks configuration, integrations and native versions without model calls.",
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
