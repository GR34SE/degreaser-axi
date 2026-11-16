# Claude Code

Native Read/Grep/Glob/Bash tool allowlist; Bash limited by native allow rules and dontAsk mode to read-only git subcommands, with deny rules for an option placed before the subcommand, for git grep and git blame (the Grep tool searches files instead), for git output, pager and --no-index options, for absolute, ~ and .. path arguments and for quoting, escapes, expansions and redirection. Settings sources, skills, hooks and MCP disabled by the worker launcher. Managed policy is retained.

- Native tool allowlist and Bash permission rules are not an OS sandbox for the adapter or for the commands Bash runs.
- Bash rules match command text with Claude Code's own parser; commands Claude Code classifies as read-only may also run. git keeps user and repository configuration, including diff drivers and textconv filters.
- git grep and git blame are denied, including Claude Code's built-in read-only use of git grep, because Claude Code's rule wildcards span argument boundaries and cannot single out their file-reading short options (grep -f, -O; blame -S) without refusing ordinary use. Any git option before the subcommand (git --no-pager log, git -P grep) is denied, so the subcommand rules cannot be bypassed. The path deny rules match spelling, not location: they also refuse absolute paths inside the repository and a revision range written with an empty left side (..HEAD), and they cannot match a path glued to a short option, so git diff, log and show -O<orderfile> and git ls-files -X<file> can read a file outside the repository; git uses it only to order or filter the listing and does not print it.
- dontAsk mode also denies Read, Grep and Glob outside the worker's working directory.
- Managed host policy is retained; conflicting policy blocks operation. Harmless plugin metadata may remain.
- Claude's review-time --model adds any requested ID to the session catalog, so a review-time catalog check cannot confirm the model; admission checks a catalog discovered without --model. Neither proves provider availability.
- Native harness session/cache writes are outside the reviewed source.
