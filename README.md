# degreaser-axi

Focused slop review for coding agents: one aspect per fresh, isolated, read-only worker, repository context, evidence returned through an AXI CLI. A better deslop: the calling agent gets evidence from 16 specialised reviewers and decides what to fix.

**Status: specification being closed; product development has not started.** There is no working Degreaser CLI or installable product yet.

Start with the [specification](specs/pending/degreaser.md) and [development handoff](specs/pending/development.md). The package includes:

- [CLI, scope, configuration, statuses and result contracts](specs/pending/contracts.md)
- [Run owner, waiting, worker profile, retries, state and resume](specs/pending/execution.md)
- [Init, skill discovery, Codex sandbox and waiting per harness](specs/pending/init.md)
- [Worker instructions](specs/pending/worker.md) and [16 aspects with boundaries and 96 teaching examples](specs/pending/aspects.md)
- [Future product skill template](specs/pending/templates/degreaser/SKILL.md)
- [Local environment](specs/pending/environment.md) and [independent review with resolutions](specs/pending/review-opus-2026-11-04.md)
- [Sources](specs/pending/sources.md), [decision history](specs/pending/review-notes.md) and [deferred work](specs/TODO.md)

The caller supplies the code scope, task and branch base when needed. Degreaser resolves the change once and gives every worker the same patch. Workers can read the repository for context but cannot run commands or edit files. All 16 aspects are enabled by default and run concurrently unless a positive `concurrency` limit is set. Results and progress stay in ignored `.degreaser/`; init adds its ignore rule to the project's `.gitignore`.

Init prefills a recommended small model, and the user explicitly confirms or changes it. The same CLI must work from Codex, Claude Code, Droid and Pi without caller configuration. Worker execution uses [acpx](https://github.com/openclaw/acpx). Adapter behavior, account access and model availability still need integration validation in development.

A portable skill teaches discovery and usage. The calling agent stays until review actually completes; each run is owned by a per-run background process, so a caller whose command timed out re-attaches with `degreaser-axi wait <run-id>`. Whether init should offer optional hooks remains open (D08).

## Working on this repository

Read [AGENTS.md](AGENTS.md) and the [seven repository skills](.agents/skills/README.md). Skills live in `.agents/skills/` (Codex, Pi); `.claude/skills/` symlinks them for Claude Code. Development requires no-mistakes, deslop-scoped and thermo-nuclear-code-quality-review; test work also uses test-audit. No pipeline has been initialized or run.

`specs/` and `.lavish/` are intentionally ignored by Git, so the links above work only in the author's checkout; a clone does not contain them. The [closed CLI prototype](.lavish/degreaser.html) is historical workshop version 0.6. The Backpass reference in `.references/backpass/` is also ignored and is not a dependency.

Copied skills keep their MIT licenses and sources in `SOURCE.md` and `LICENSE` files next to each `SKILL.md`.
