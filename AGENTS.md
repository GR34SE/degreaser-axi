# Working on degreaser-axi

## Current phase

The specification is being closed after an independent review (`specs/pending/review-opus-2026-11-04.md`). Product implementation has not been authorized; it requires a separate instruction from the user. Until then, change only the specification, README, this file, repository skills and their setup. Do not create a runtime, package scaffold or production tests. The Lavish prototype in `.lavish/` is frozen at workshop version 0.6 and is historical; do not update or reopen it.

Start with `specs/pending/degreaser.md`, then `contracts.md`, `execution.md`, `init.md`, `worker.md` and `development.md` in that directory. `review-notes.md` is history, not a source for restoring superseded decisions. Released project material, CLI output, skills and worker rubrics are English (D12); local gitignored specs may remain Polish. v1 supports Codex, Claude, Pi and Droid; Grok Build is deferred (D13). All 16 aspects are ON by default; the old 12/4 split is obsolete. Separate accepted requirements from technical proposals (the proposal register is in `contracts.md`). The existing `.gitignore` excludes `specs/` and `.lavish/`; preserve that choice unless the user changes it. Commit or push only when the user asks.

`specs/` is ignored, so it exists only in this checkout: `/Users/adriancelczynski/Projects/degreaser-axi/specs`. In any other worktree, create a symlink `specs -> /Users/adriancelczynski/Projects/degreaser-axi/specs` (the ignore rule covers it) or read the files by absolute path. Never `git add -f` them without an instruction.

## Product constraints

- The caller provides scope, target base when needed, and task context. Review the change; use the repository as context. Full-repository review is explicit.
- The coordinator may run in a caller session with full access; worker tools remain separately read-only. Init does not modify Codex rules or global permission settings. Restricted callers use only host-supported per-command approval, or report that the environment is blocked.
- Each worker gets one aspect and a fresh, isolated, read-only session. The coordinator resolves the change; the worker reports evidence; the calling agent decides and edits.
- Use acpx and the harness's tools. Reuse existing capabilities before proposing new infrastructure or dependencies.
- All 16 built-in aspects are enabled by default. Each aspect has three good and three bad code examples with context and explanations, plus symmetric "not here" boundaries. Do not turn syntax preferences or one anecdote into universal slop rules.
- Persist local run results and queue state under ignored `.degreaser/`. Run all enabled aspects concurrently by default; a positive `concurrency` optionally caps active reviewers. Bound retries and preserve successful results for continuation.
- The caller waits without editing until completed/partial/failed. A run is owned by a per-run background process, so the caller can re-attach with `wait <run-id>` when its own command times out. Keep the selected agent and model; never switch them silently.
- Init adds `/.degreaser/` to the root project `.gitignore`. Every init requires the user to confirm or change the prefilled model choice. The CLI works across Codex, Claude, Droid and Pi without caller configuration. D08 is settled: selecting harnesses in init installs their startup hooks/native equivalents and skill, without a separate hook-versus-skill choice. Support all four harnesses. Do not install product hooks during specification work.
- Custom aspects are outside v1; configuration of built-in aspects is in scope. See `specs/TODO.md`.

## Skills and references

Skills live in `.agents/skills/` (read natively by Codex and Pi). `.claude/skills/` contains symlinks to the same directories for Claude Code. Upstream skills are installed with the Skills CLI and recorded in `skills-lock.json`. Do not fork them in place. The local `deslop-scoped` skill reads installed `deslop` by path and applies the caller-selected scope instead of the upstream main-branch assumption. Read required skills by project path to avoid personal copies taking precedence. If a skill does not load automatically in your harness, read its `SKILL.md` by path.

- For writing or revising aspects, read `.agents/skills/write-degreaser-aspect/SKILL.md` and its template. Verify library-specific examples against current documentation.
- For AXI command/output/integration design, read `.agents/skills/axi/SKILL.md`. D08 combines startup integration and the skill in one harness-selection step; see `specs/pending/init.md`.
- For a future authorized visual workshop, read `.agents/skills/lavish/SKILL.md` and current CLI playbooks. Keep that session; after applying feedback, reply through `lavish-axi poll ... --agent-reply-file ...` and stay attached until the user ends or pauses the review.
- During implementation, use `deslop-scoped` and `thermo-nuclear-code-quality-review` on the authorized change and the caller-selected scope, not an assumed main branch. For test work also read `test-audit`. Read thermo-nuclear by path: it disables model auto-invocation.
- `no-mistakes` is the development validation pipeline once implementation begins. It needs `no-mistakes init`, commits, push, PR and CI towards the public `origin`. Run init or any delivery step only when the user's instruction covers delivery; otherwise stop before them and ask. Its intent is published to the PR description by default; use `--no-publish-intent` unless the user agrees to publish specification details.
- Backpass is a read-only reference at `.references/backpass/`, excluded from Git. Do not edit, install or execute it. Inspect its README, `src/analyze.js`, `src/state.js`, `src/acpx.js` and `src/acpx-output.js` when reviewing queue, state and worker invocation design.
- `effect-ts-is-king` informed the generic reuse-existing aspect. Its example does not choose Effect as Degreaser's implementation stack and does not mandate Effect in reviewed projects.

For library, framework or CLI documentation use Context7: resolve with `npx ctx7@latest library <name> "<specific question>"` before `docs <id> "<question>"`; at most three calls per question. Use version-matched primary sources if the indexed documentation is ambiguous. Never put secrets in queries. A quota failure must be reported; suggest login or `CONTEXT7_API_KEY` rather than silently relying on memory.

## Change hygiene

Preserve user edits and staged files. Inspect the current Git state before editing. If a development task later needs a new worktree, use `/Users/adriancelczynski/worktrees/manual/<owner-repo>/<task-id>` unless one is already assigned, and link `specs/` as described above; leave tool-managed worktrees with their owner. Reference clones are not implementation worktrees.

Use the smallest complete design. Name the actual obligation before adding a layer. Do not claim an example, prototype, source review or unexercised adapter was run successfully. Report checks performed and remaining uncertainty plainly.
