export const DESCRIPTION =
  "Review code changes with focused, read-only reviewers and source evidence.";

export const CALLER_GUIDANCE = [
  "Provide the actual task and explicit worktree, branch or repository scope. Branch requires the base supplied by the user; never guess it.",
  "Every init requires the user's confirmed agent/model and selected Codex, Claude or Pi harnesses. Do not choose or switch models for the user.",
  "Do not edit code while a run is active. On running (exit 3) or a caller-tool timeout, run `degreaser-axi wait <run-id>` until a terminal result.",
  "Claude Code: allow --wait plus 60 seconds in Bash (maximum 600000 ms); follow a background completion notification. Codex: poll the same command session. Pi: use the normal command tool.",
  "Completed and no-changes exit 0; findings alone are not failure. Partial, failed or interrupted exit 1; inspect missing coverage. Usage, decision and environment errors exit 2.",
  "Inspect evidence with `degreaser-axi finding <id>` or `degreaser-axi report --full`. Not-applicable is not a quality certificate. Decide justified fixes yourself; Degreaser never applies patches.",
  "Resume only unchanged review input. After edits, start a new review, optionally narrowing --aspects.",
  "If DEGREASER_WORKER is set, do not invoke Degreaser or use this skill. Never change global permissions, install Codex rules or bypass host restrictions.",
];
