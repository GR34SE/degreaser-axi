# Pi

Native read/grep/find/ls/bash tool allowlist; bash limited by the launcher's own extension, which blocks any call that is not a read-only git subcommand with plain arguments. Skills, other extensions, MCP, context files and prompt templates disabled by the worker launcher.

- Native tool allowlist and the bash extension gate are not an OS sandbox for the adapter or for the git commands bash runs.
- git keeps user and repository configuration, including diff drivers and textconv filters.
- Offline suppresses startup discovery, not subscription model traffic.
- Native harness session/cache writes are outside the reviewed source.
