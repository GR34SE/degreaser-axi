# degreaser-axi

Focused slop review for coding agents.

Degreaser gives your coding agent a second look at the feature it just built. It distributes the review across small models: each reviewer starts with a fresh context, investigates one kind of code slop, and returns evidence. Your coding agent decides what to fix.

> Not released yet. This development build runs source-only reviews, waits for detached runs, cancels active runs, resumes unresolved unchanged work, and reads saved reports/findings. Init and startup integrations are still under development.

- **Review the change, understand the repository.** Reviewers assess your diff and can follow callers, tests, dependencies and existing helpers across the repo.
- **One aspect per reviewer.** Sixteen focused reviews, each with examples of problems to report and justified code to preserve.
- **Findings with evidence.** Each finding includes a location, quoted code, a concrete consequence, a checked counterargument and a suggested direction.
- **You keep control.** Reviewers only read code. Your coding agent evaluates the findings and makes the changes.

## Get started

Workers support Codex, Claude Code and Pi on macOS with Node 24+. Droid and Grok Build are deferred. Model calls use your authenticated harness through [acpx](https://github.com/openclaw/acpx).

To inspect the current interface from a local checkout (pnpm 12.14.0):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/bin/degreaser-axi.js --help
node dist/bin/degreaser-axi.js --version
```

There is no published npm installation or self-update path.

For direct use now, put your explicitly selected `agent` and exact `model` in the
target repository's root `.degreaserrc.json` and add `/.degreaser/` to its root
`.gitignore`. From that repository, invoke the absolute path to this checkout's
`dist/bin/degreaser-axi.js` with Node. The examples below use `degreaser-axi` as
shorthand for that command. Use `--aspects A06` for a first one-aspect review.

The worker profiles currently require Codex ACP 2.5.0 with bundled Codex 0.165.0,
Claude Code 2.1.317, or Pi 1.4.0. See [native worker restrictions and limits](assets/native-profiles.md).

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

If a review returns `running`, use its supplied `degreaser-axi wait <run-id>` command. Keep the code unchanged until the run finishes. If some reviewers fail, their completed peers' results remain available.

`review` and `wait` accept `--wait <seconds>` (default 480). A short wait returns
`running` with exit 3, not success. A caller timeout or killed waiting command
does not stop the detached run: attach again with `wait`, not a replacement
`review`. Repeated waits on a finished run only read its result.

Use `degreaser-axi cancel <run-id>` to stop a run. Cancellation signals its
verified owner, stops queued work and retries, and waits for owned worker cleanup.
Useful results and attempt history remain available: cancellation returns
`partial` or `failed` with exit 1. A run that finished first remains completed
with exit 0. No permanent background service remains after cleanup.

Use `degreaser-axi resume <run-id>` after partial failure, cancellation or owner
interruption. It rechecks source, task-file contents, resolved base, prompts and
selected agent/model before continuing only unresolved aspects. Successful
results stay intact, and earlier attempts (including incomplete evidence) remain
in `report --full`. Changed input requires a new review. Unchanged completed runs
return `already-completed` without starting anything.

Resume accepts `--concurrency <n>` and `--wait <seconds>`. It keeps the original
absolute deadline unless you explicitly supply `--deadline <seconds>`, which
starts a new budget at the resumed owner's start. An expired deadline requires
this deliberate override. Prefer these invocation controls to editing an RC
that is itself part of the reviewed source.

A live owner cannot be evicted just because its heartbeat is old. Recovery
checks process birth identities and joins verified old work before replacement
attempts. If a lock or PID is ambiguous, it refuses takeover rather than
signalling unrelated processes. Follow the reported local inspection guidance;
do not remove locks while an owner or worker is still active.

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

The root `.degreaserrc.json` stores your chosen harness and model. You can disable built-in aspects, set a concurrency limit, or override the model for individual aspects. Init will write this file once onboarding is implemented.

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

Before creating a run, review checks selected pairs against native model catalogs
without inference. Unsupported pairs return `invalid-input`; discovery/auth/host
failures return `environment-blocked`, both with exit 2 and no new run.
Catalog membership is not a provider-access guarantee. In particular, Claude's
review-time catalog includes the requested model, so its runtime identity check
cannot independently detect later provider withdrawal. No model fallback is used.

The root RC follows the strict versioned schema in `dist/assets/schemas/config-v1.json`. Unknown fields and explicitly selected disabled aspects are errors. See `dist/assets/input-contract.md` in the built package for exact bounds, literal-path exclusions and Git representation limits.

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
degreaser-axi doctor         # Local configuration/native-version diagnostics, no inference.
```

Each finding explains what is wrong, where it occurs, why it matters and what would improve it. Incomplete reviews are marked explicitly. Reviewers inspect source; they do not run tests or claim runtime verification.

Short reports show at most 30 findings, with total/shown counts and per-aspect
coverage, limitations and rejections. Overlapping locations on the same old/new
side share a group but retain separate evidence. `report --full` and `finding`
do not clip evidence. Usage is `unknown` unless recorded metadata is available.

Pass `report <run-id>` or `finding F1 --run <run-id>` to read historical evidence;
otherwise reads select this repository's latest run. Reports of running reviews
return the current snapshot without waiting. Home reads history even without a
current RC. These read commands do not start reviews or modify local state.
Full reports separate configured identities from actual attempts and
coordinator-only applicability results, including A08 in repository audits.

Results and progress are saved locally in ignored `.degreaser/`. Review context is sent through your chosen harness to its model provider. Degreaser does not apply fixes; your coding agent decides which findings warrant changes.

A real one-aspect Claude Haiku review returned `completed`, `aspects: 1/1` and a
source-only finding quoting `// Return the sum of two numbers.` The literal quote
passed validation; the caller still decides whether its recommendation applies.
Zero findings is equally valid. See [result validation and local data limits](assets/result-contract.md).
Stored tasks, patches and quotes can contain sensitive code; do not publish local run artifacts.
