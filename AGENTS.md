# Working on degreaser-axi

## Current phase

Product implementation is authorized. The foundation supplies a package, public command help/version and the catalog; review execution and integrations remain under development. Start from `specs/README.md`; `specs/pending/review-opus-2026-11-04.md` is historical review context. The Lavish prototype in `.lavish/` is frozen at workshop version 0.6 and is historical; do not update or reopen it.

Start with `specs/pending/degreaser.md`, then `contracts.md`, `execution.md`, `init.md`, `worker.md` and `development.md` in that directory. `review-notes.md` is history, not a source for restoring superseded decisions. Released project material, CLI output, skills and worker rubrics are English (D12); local gitignored specs may remain Polish. Current v1 supports **Codex, Claude Code and Pi on macOS, Node 24+**. Droid and Grok Build are deferred; this supersedes the original D13. All 16 aspects are ON by default; the old 12/4 split is obsolete. Separate accepted requirements from technical proposals (the proposal register is in `contracts.md`). Preserve the existing ignores for `specs/` and `.lavish/`.

The user authorized autonomous commits and final GitHub delivery: push, PR, green CI, main protection requiring PR/checks without a mandatory second reviewer, and merge. Remote changes belong to the final delivery feature, not intermediate workers. **No npm publication or publication of private specifications/intent.** Preserve configured Git authorship.

`specs/` is ignored, so it exists only in this checkout: `/Users/adriancelczynski/Projects/degreaser-axi/specs`. In any other worktree, create a symlink `specs -> /Users/adriancelczynski/Projects/degreaser-axi/specs` (the ignore rule covers it) or read the files by absolute path. Never `git add -f` them without an instruction.

## Product constraints

- The root README is for Degreaser users: purpose, setup, usage, configuration and results. Keep development handoff, internal decisions and local spec links in `specs/` and this file, not in the README. Until release, label planned usage honestly; do not invent installation instructions for an unpublished package.
- The caller provides scope, target base when needed, and task context. Review the change; use the repository as context. Full-repository review is explicit.
- The coordinator may run in a caller session with full access; worker tools remain separately read-only. Init does not modify Codex rules or global permission settings. Restricted callers use only host-supported per-command approval, or report that the environment is blocked.
- Each worker gets one aspect and a fresh, isolated, read-only session. The coordinator resolves the change; the worker reports evidence; the calling agent decides and edits.
- Use acpx and the harness's tools. Reuse existing capabilities before proposing new infrastructure or dependencies.
- All 16 built-in aspects are enabled by default. Each aspect has three good and three bad code examples with context and explanations, plus symmetric "not here" boundaries. Do not turn syntax preferences or one anecdote into universal slop rules.
- Persist local run results and queue state under ignored `.degreaser/`. Run all enabled aspects concurrently by default; a positive `concurrency` optionally caps active reviewers. Bound retries and preserve successful results for continuation.
- The caller waits without editing until completed/partial/failed. A run is owned by a per-run background process, so the caller can re-attach with `wait <run-id>` when its own command times out. Keep the selected agent and model; never switch them silently.
- Init adds `/.degreaser/` to the root project `.gitignore`. Every init requires the user to confirm or change the prefilled model choice. The CLI works across Codex, Claude and Pi without caller configuration. D08 is settled: selecting harnesses installs their startup hooks/native equivalents and skill, without a separate hook-versus-skill choice. Test installations only in disposable projects/homes, never actual user/global projects. Do not use the AXI bulk installer, which changes unselected targets and global Codex features.
- Custom aspects are outside v1; configuration of built-in aspects is in scope. See `specs/TODO.md`.

## Skills and references

Skills live in `.agents/skills/` (read natively by Codex and Pi). `.claude/skills/` contains symlinks to the same directories for Claude Code. Upstream skills are installed with the Skills CLI and recorded in `skills-lock.json`. Do not fork them in place. The local `deslop-scoped` skill reads installed `deslop` by path and applies the caller-selected scope instead of the upstream main-branch assumption. Read required skills by project path to avoid personal copies taking precedence. If a skill does not load automatically in your harness, read its `SKILL.md` by path.

- For writing or revising aspects, read `.agents/skills/write-degreaser-aspect/SKILL.md` and its template. Verify library-specific examples against current documentation.
- For AXI command/output/integration design, read `.agents/skills/axi/SKILL.md`. D08 combines startup integration and the skill in one harness-selection step; see `specs/pending/init.md`.
- For a future authorized visual workshop, read `.agents/skills/lavish/SKILL.md` and current CLI playbooks. Keep that session; after applying feedback, reply through `lavish-axi poll ... --agent-reply-file ...` and stay attached until the user ends or pauses the review.
- During implementation, use `deslop-scoped` and `thermo-nuclear-code-quality-review` on the authorized change and the caller-selected scope, not an assumed main branch. For test work also read `test-audit`. Read thermo-nuclear by path: it disables model auto-invocation.
- `no-mistakes` is required for the final delivery feature after real checks and product validation pass. That feature owns init, push, PR, CI and merge towards public `origin`; intermediate workers must not start a competing pipeline. Always use `--no-publish-intent`. Do not publish private specification details.
- Backpass is a read-only reference at `.references/backpass/`, excluded from Git. Do not edit, install or execute it. Inspect its README, `src/analyze.js`, `src/state.js`, `src/acpx.js` and `src/acpx-output.js` when reviewing queue, state and worker invocation design.
- `effect-ts-is-king` informed the generic reuse-existing aspect. Its example does not choose Effect as Degreaser's implementation stack and does not mandate Effect in reviewed projects.

For library, framework or CLI documentation use Context7: resolve with `npx ctx7@latest library <name> "<specific question>"` before `docs <id> "<question>"`; at most three calls per question. Use version-matched primary sources if the indexed documentation is ambiguous. Never put secrets in queries. A quota failure must be reported; suggest login or `CONTEXT7_API_KEY` rather than silently relying on memory.

## Change hygiene

One small ESM TypeScript package uses strict NodeNext and erasable syntax, compiled JavaScript, public AXI routing/TOON, public `acpx/runtime`, Ajv and Node built-ins. Keep dependencies and pnpm pinned. Lifecycle scripts and unnecessary builds are denied. Do not approve dependency skills automatically. Only necessary exact local package-age exceptions are authorized; remove obsolete exceptions before delivery. Never weaken global security policy.

Public product assets live in `assets/`, not ignored `specs/`. Builds and runtime must work in a clean checkout without private material. The product skill is generated from `src/guidance.ts`; run `pnpm skill:generate` after changing it. Build checks drift rather than silently accepting stale guidance.

Commands from the repository root:

- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm test` (build plus deterministic Node tests, concurrency 2)
- `pnpm typecheck`
- `pnpm lint` (lint and format check); `pnpm format` applies fixes
- `pnpm build` (JavaScript, assets and generated skill check)
- `pnpm package:check` (separate installed tarball; set `DEGREASER_NODE24_MIN` to a verified Node 24.0.0 executable for the minimum-version smoke)
- `pnpm check` (all deterministic gates)
- `pnpm test:live --help` (opt-in tooling, outside ordinary CI; unimplemented scenarios return nonzero and never count as passes)

Use meaningful failing tests before behavior changes. Test public CLI/process boundaries and real disposable Git repositories with independent expected outcomes. Preserve failed/unrun results. Source text assertions protect prompt/asset interfaces only, not model interpretation. Live subscription tests use synthetic code, exact confirmed models and a fresh quota check, without paid API fallback. No servers or ports are needed. Stop only processes owned by the test.

Preserve user edits and staged files. Inspect the current Git state before editing. If a development task later needs a new worktree, use `/Users/adriancelczynski/worktrees/manual/<owner-repo>/<task-id>` unless one is already assigned, and link `specs/` as described above; leave tool-managed worktrees with their owner. Reference clones are not implementation worktrees.

Use the smallest complete design. Name the actual obligation before adding a layer. Do not claim an example, prototype, source review or unexercised adapter was run successfully. Report checks performed and remaining uncertainty plainly.
