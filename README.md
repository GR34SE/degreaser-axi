# degreaser-axi

Focused slop review for coding agents.

Degreaser gives your coding agent a second look at the feature it just built. It distributes the review across small models: each reviewer starts with a fresh context, investigates one kind of code slop, and returns evidence. Your coding agent decides what to fix.

> Not released yet. This development build provides help, version and the public review catalog. Review execution and integrations are not implemented yet. The workflow below describes the planned v1 interface.

- **Review the change, understand the repository.** Reviewers assess your diff and can follow callers, tests, dependencies and existing helpers across the repo.
- **One aspect per reviewer.** Sixteen focused reviews, each with examples of problems to report and justified code to preserve.
- **Findings with evidence.** Each finding includes a location, quoted code, a concrete consequence, a checked counterargument and a suggested direction.
- **You keep control.** Reviewers only read code. Your coding agent evaluates the findings and makes the changes.

## Get started

The planned integrations cover Codex, Claude Code and Pi on macOS with Node 24+. Droid and Grok Build are deferred. Model calls will use your authenticated harness through [acpx](https://github.com/openclaw/acpx).

To inspect the current interface from a local checkout (pnpm 12.14.0):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/bin/degreaser-axi.js --help
node dist/bin/degreaser-axi.js --version
```

There is no published npm installation or self-update path.

Planned setup in your project:

```sh
degreaser-axi init
```

Choose the harnesses you use and confirm or change the suggested small model. Init installs their startup integrations and the Degreaser skill, writes `.degreaserrc.json`, and adds `/.degreaser/` to your project's `.gitignore`.

Then ask your coding agent:

> Run Degreaser on my current changes for the CSV import feature. Wait for the review, assess the findings, and fix the ones that apply.

For a feature branch, name its target:

> Review this branch against develop with Degreaser. The task was to add CSV import with quoted-field support.

The agent supplies the scope and task, starts the review, and waits before editing. Startup integrations make Degreaser discoverable; they do not launch reviews or make model calls on their own.

## Review from the CLI

```sh
# Current work: staged, unstaged and new non-ignored files.
degreaser-axi review --scope worktree --task "Add CSV import with quoted-field support"

# Feature branch, including local work, against an explicitly chosen target.
degreaser-axi review --scope branch --base develop --task "Add CSV import with quoted-field support"

# Whole-repository review is explicit and can cost more.
degreaser-axi review --scope repository --task "Review the repository for unnecessary complexity"
```

Use `--task-file <path>` instead of `--task` for a longer brief. An empty diff finishes without starting reviewers.

If a review returns `running`, use its supplied `degreaser-axi wait <run-id>` command. Keep the code unchanged until the run finishes. If some reviewers fail, their completed peers' results remain available; `resume <run-id>` continues unresolved work while the review input is unchanged.

## What it looks for

All 16 aspects are enabled by default.

| ID | Aspect | Review question |
| --- | --- | --- |
| A01 | Reuse existing solutions | Does the repo or an existing dependency already solve this? |
| A02 | Unnecessary layers | Does this wrapper, service or factory add useful behavior or a boundary? |
| A03 | Speculative flexibility | Do these options and extension points serve a current requirement? |
| A04 | Masked errors | Does a fallback turn failure into apparent success? |
| A05 | Unjustified defense | Does this check protect a real boundary or possible state? |
| A06 | Low-value comments | Does the comment explain something the code cannot? |
| A07 | Repository conventions | Does this introduce another way to do the same thing without a reason? |
| A08 | Scope creep | Did the change add features or refactoring outside the task? |
| A09 | Contract bypass | Does a cast, suppression or default hide a real mismatch? |
| A10 | Test value | Would this test detect broken behavior, or just confirm its own mock? |
| A11 | Incomplete integration | Is the new code connected to the real user path? |
| A12 | Wrong abstraction | Does a shared mechanism combine cases with conflicting rules? |
| A13 | Custom infrastructure | Does a handwritten cache, parser or similar mechanism miss required semantics? |
| A14 | Language and platform idioms | Can a native construct remove unnecessary logic without changing behavior? |
| A15 | Structural erosion | Does this change concentrate more responsibilities and branching in an overloaded unit? |
| A16 | Verification theater | Does a runtime or tooling check prove the property it claims to verify? |

A loop, wrapper, validation check or smoke test is not automatically slop. Reviewers must establish a concrete problem in context, check reasons to preserve the code, and accept zero findings as a valid result.

## Configure the review

Init saves your chosen harness and model in `.degreaserrc.json`. You can disable built-in aspects, set a concurrency limit, or override the model for individual aspects.

For example, after selecting Codex and Luna:

```json
{
  "agent": "codex",
  "model": "gpt-6-luna",
  "concurrency": 4,
  "aspects": {
    "disable": ["A06"]
  }
}
```

Without a concurrency limit, all enabled aspects can run in parallel. A lower limit reduces simultaneous calls; it does not reduce the number of aspects reviewed. Retries and continuation keep your selected harness and model.

The root RC follows the strict versioned schema in `dist/assets/schemas/config-v1.json`. Unknown fields and explicitly selected disabled aspects are errors. See `dist/assets/input-contract.md` in the built package for exact bounds, literal-path exclusions and Git representation limits. Public review execution is still under development.

To review only specific aspects for one run, without changing your configuration:

```sh
degreaser-axi review --scope worktree --task "Fix CSV parsing" --aspects A01,A13
```

## Read the results

The CLI follows [AXI](https://axi.md/): a short summary, details on demand, and commands for the next step.

```sh
degreaser-axi report          # Latest run and findings.
degreaser-axi report --full   # Full evidence.
degreaser-axi finding F1     # One finding from the latest run.
degreaser-axi doctor         # Configuration and integration diagnostics.
```

Each finding explains what is wrong, where it occurs, why it matters and what would improve it. Incomplete reviews are marked explicitly. Reviewers inspect source; they do not run tests or claim runtime verification.

Results and progress are saved locally in ignored `.degreaser/`. Review context is sent through your chosen harness to its model provider. Degreaser does not apply fixes; your coding agent decides which findings warrant changes.
