---
name: deslop-scoped
description: Remove AI-generated code slop from the caller-selected diff without assuming a base branch. Use for Degreaser development cleanups instead of the global deslop skill.
---

# Remove AI code slop

Check the caller-selected diff and its relevant context. During implementation, remove slop only within the authorized change. Do not choose main or another target branch implicitly.

## Focus Areas

- Extra comments that are unnecessary or inconsistent with local style
- Defensive checks or try/catch blocks that are abnormal for trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should be simplified with early returns
- Other patterns inconsistent with the file and surrounding codebase

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Prefer minimal, focused edits over broad rewrites.
- Keep the final summary concise (1-3 sentences).
