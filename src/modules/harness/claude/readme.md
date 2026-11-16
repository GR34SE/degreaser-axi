# Claude Code

Native Read/Grep/Glob tool allowlist; settings sources, skills, hooks and MCP disabled by the worker launcher. Managed policy is retained.

- Native Read/Grep/Glob allowlist is not an OS sandbox for the adapter.
- Managed host policy is retained; conflicting policy blocks operation. Harmless plugin metadata may remain.
- Claude's review-time --model adds any requested ID to the session catalog, so a review-time catalog check cannot confirm the model; admission checks a catalog discovered without --model. Neither proves provider availability.
- Native harness session/cache writes are outside the reviewed source.
