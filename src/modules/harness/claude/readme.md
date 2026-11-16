# Claude Code

Native Read/Grep/Glob/Bash tool allowlist; Bash limited by native allow rules and dontAsk mode to read-only git subcommands, with deny rules for git output, pager and --no-index options and for quoting, escapes, expansions and redirection. Settings sources, skills, hooks and MCP disabled by the worker launcher. Managed policy is retained.

- Native tool allowlist and Bash permission rules are not an OS sandbox for the adapter or for the commands Bash runs.
- Bash rules match command text with Claude Code's own parser; commands Claude Code classifies as read-only may also run. git keeps user and repository configuration, including diff drivers and textconv filters.
- The git grep deny rule also refuses harmless searches with an uppercase O after an option; the Grep tool remains.
- dontAsk mode also denies Read, Grep and Glob outside the worker's working directory.
- Managed host policy is retained; conflicting policy blocks operation. Harmless plugin metadata may remain.
- Claude's review-time --model adds any requested ID to the session catalog, so a review-time catalog check cannot confirm the model; admission checks a catalog discovered without --model. Neither proves provider availability.
- Native harness session/cache writes are outside the reviewed source.
