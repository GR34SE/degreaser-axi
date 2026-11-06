# degreaser-axi

Focused slop review for coding agents.

Degreaser gives your coding agent a second look at the feature it just built. It distributes the review across small models: each reviewer starts with a fresh context, investigates one kind of code slop, and returns evidence. Your coding agent decides what to fix.

> Not released yet. This development build runs source-only reviews, waits for detached runs, cancels active runs, resumes unresolved unchanged work, and reads saved reports/findings. Init confirms worker models and installs selected native startup integrations and skills.

- **Review the change, understand the repository.** Reviewers assess your diff and can follow callers, tests, dependencies and existing helpers across the repo.
- **One aspect per reviewer.** Sixteen focused reviews, each with examples of problems to report and justified code to preserve.
- **Findings with evidence.** Each finding includes a location, quoted code, a concrete consequence, a checked counterargument and a suggested direction.
- **You keep control.** Reviewers only read code. Your coding agent evaluates the findings and makes the changes.

## Get started

You need macOS, Node 24.0.0 or newer, Git, and an authenticated supported native harness. Workers support Codex, Claude Code and Pi. Linux, Windows, Droid and Grok Build are not supported in v1. Model calls use your native subscription login through [acpx](https://github.com/openclaw/acpx); Degreaser does not manage credentials or fall back to paid API keys.

To inspect the current interface from a local checkout (pnpm 12.14.0):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/bin/degreaser-axi.js --help
node dist/bin/degreaser-axi.js --version
```

There is no published npm installation or self-update path.

### Install a local tarball

From the built checkout, create a local package:

```sh
pnpm pack
```

Install it in a separate tools directory, not in the repository you want to
review. Replace the absolute paths below with your own:

```sh
mkdir -p /absolute/path/to/degreaser-local
cd /absolute/path/to/degreaser-local
printf '%s\n' '{"private":true,"packageManager":"pnpm@12.14.0"}' > package.json
pnpm add --ignore-scripts /absolute/path/to/degreaser-axi/degreaser-axi-0.1.0.tgz
export PATH="/absolute/path/to/degreaser-local/node_modules/.bin:$PATH"
degreaser-axi --version
degreaser-axi review --help
```

Use a new tools directory so the `package.json` command does not overwrite an
existing project. Preserve your package manager's security policy; resolve a
blocked dependency explicitly rather than disabling checks. Keep this installation
at a stable path: installed startup integrations reference its executable.
Alternatively, use `node /absolute/path/to/degreaser-axi/dist/bin/degreaser-axi.js`
from a built checkout wherever the examples say `degreaser-axi`.

Run subsequent commands **inside the Git repository you want to review**.
Init confirms its worker model, writes `.degreaserrc.json`, installs selected
integrations and adds root `.gitignore` coverage for `/.degreaser/` without
changing the index. Use `--aspects A06` for a first one-aspect review.

The worker profiles currently require Codex ACP 2.5.0 with bundled Codex 0.165.0,
Claude Code 2.1.317, or Pi 1.4.0. Claude and Pi must already be on PATH;
Codex's worker executable is bundled with its pinned adapter.
See [native worker restrictions and limits](https://github.com/GR34SE/degreaser-axi/blob/main/assets/native-profiles.md)
in the source, or `dist/assets/native-profiles.md` in the built checkout or
installed package.

Discover and confirm a model in your project:

```sh
degreaser-axi init
```

Choose the harnesses you use and confirm or change the suggested small model.
Every init, including reinit, requires your decision. In a terminal, Enter
confirms the displayed prefill; enter a candidate number to change it. Without
a terminal, missing decisions return `decision-required` (exit 2) with exact
candidates and example commands, without writing product files. After the user
chooses, provide `--agent`, `--model` and `--harnesses` explicitly. The existing
RC is not consent for a later invocation.

For example, **after choosing this exact model and these harnesses**:

```sh
degreaser-axi init --agent codex --model gpt-6-luna --harnesses codex,claude,pi
degreaser-axi doctor
degreaser-axi review --scope worktree --task "Add CSV import with quoted-field support" --aspects A06
degreaser-axi report
```

`--agent` selects the reviewer harness; `--harnesses` selects caller
integrations. Choose only the integrations you use.

Init reads native catalogs without inference. It shows the credential source,
not private account identities, and does not guarantee later provider availability.
Invalid choices or failed discovery never silently select a replacement.
Init preserves other RC settings and installs both the startup integration and
skill for each selected harness. Installation defaults to the project; use
`--installation-scope user` explicitly for user-wide integration. RC and ignore
setup still belong to the current project. Nothing changes global permissions,
Codex features/rules, or your AGENTS.md and CLAUDE.md instructions.

Start a new harness session after installation (or reload Pi). **Installed does
not mean active:** host trust and hook policy still apply. Codex 0.165.0 enables
hooks by default but separately requires project and hook trust. Approve through
the host only if you trust the command; Degreaser never grants trust itself.

To repair moved package paths or missing owned files, run
`degreaser-axi setup hooks --harnesses codex,claude,pi` with your selected targets
and the original scope. Add `--remove` to remove only owned entries. Foreign
settings stay intact; edited owned files or hooks produce a conflict instead of
being overwritten. Preserve your edits elsewhere or restore the owned content
before retrying. Ownership receipts live in `.degreaser/integrations.json` at
the selected project or home root; keep them for safe maintenance. Codex and Pi
share `.agents/skills/degreaser`, retained until both owners are removed.

Startup reads only compact local context. It starts no models or reviews and
is disabled in review workers. Missing executables or invalid local state do
not block the host; use the CLI home view for state errors and setup for repair.

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
If cancel races ownership admission, it can return `run-busy` with exit 2:
cancellation was **not applied**. Retry the supplied cancel command after
admission finishes; the old terminal report does not confirm cancellation of
resumed work.

Use `degreaser-axi resume <run-id>` after partial failure, cancellation or owner
interruption. It rechecks source, task-file contents, resolved base, prompts and
selected agent/model before continuing only unresolved aspects. Successful
results stay intact, and earlier attempts (including incomplete evidence) remain
in `report --full`. Changed input requires a new review. Unchanged completed runs
return `already-completed` without starting anything.
Failure to check freshness is not proof that input changed. Git/configuration
errors keep their diagnostics; unreadable task or packaged prompt files return
`environment-blocked`. Repair access or the environment before retrying.

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
Reports mark interrupted active aspects as `interrupted`; full-report attempts
are labeled `last-persisted` history, not proof that a worker is still running.
Use the same Node executable as the original owner. For `owner-unverified`,
inspect the run's `run.json` and `owner.lock` against local PID, start-time and
process-group identities. Never signal a reused PID. If ownership remains
unverifiable, keep the old evidence and start a new review only after confirming
old work has stopped, rather than repeatedly attempting a refused resume.

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

The root `.degreaserrc.json` stores all configurable review settings, including defaults. Init writes the complete file after every explicit confirmation, preserving existing controls. You can disable built-in aspects, set a concurrency limit, or override the model for individual aspects.

For example, a fresh init after selecting Codex and Luna writes:

```json
{
  "schemaVersion": 1,
  "agent": "codex",
  "model": "gpt-6-luna",
  "concurrency": null,
  "maxRetries": 1,
  "limits": {
    "workerTimeoutSeconds": 300,
    "maxTurns": 40,
    "runTimeoutSeconds": 900
  },
  "aspects": {
    "enable": ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11", "A12", "A13", "A14", "A15", "A16"],
    "disable": [],
    "overrides": {}
  },
  "exclude": []
}
```

To disable an aspect, remove its ID from `enable` and add it to `disable`.
`enable` affirms the default selection; it is not an allowlist. An ID cannot
appear in both lists. Empty `overrides` means every aspect inherits the selected
agent and model; `exclude` adds to the fixed built-in exclusions.

After upgrading the installed package, run:

```sh
degreaser-axi config sync
```

This local command fills only missing settings with the installed defaults,
including nested settings, and reports the fields and values added. Existing
values (including empty lists, zero retries and model overrides) remain intact.
A complete file is left untouched. It does not discover models, install
integrations or check the registry. Use `init` to create a missing RC and
confirm the model and harness choices.

Older sparse files remain valid. Home/startup context, doctor and review
responses list missing settings with their defaults and suggest `config sync`;
those reads never rewrite the file or block review solely for missing defaults.
Explicit values stay pinned when package defaults change. `schemaVersion`
versions the format, not the package: adding a defaulted field does not bump it.
Unsupported versions, unknown fields and invalid settings are rejected without
rewriting the file. Sync currently completes format v1; it does not guess
conversions for future incompatible formats.

`concurrency: null` explicitly means no cap; omitting it in older files has the
same meaning. Older binaries that reject RC null need upgrading before using
a newly generated file.

Without a concurrency limit, all enabled aspects can run in parallel after the
first model invocation. A lower limit reduces simultaneous calls; it does not
reduce the number of aspects reviewed. Retries and continuation keep your selected
harness and model. A model-only entry under `aspects.overrides.A06`, for example
`{"model":"<exact-model-id>"}`, keeps the default agent. An agent override must
also supply its compatible exact model.

Defaults are one additional retry, a 300-second worker timeout, a 900-second
run deadline and a 40-turn budget. Configure `maxRetries` and
`limits.workerTimeoutSeconds`, `limits.runTimeoutSeconds`, `limits.maxTurns`.
Only Claude enforces the turn budget natively; Codex and Pi treat it as advisory.
`exclude` accepts literal repository-relative files or directory prefixes, not globs.

Missing/malformed output, discarded oversized output and attempt timeouts receive
only the configured bounded retries in fresh sessions. Auth, model, account and
rate-limit failures do not trigger automatic retries or fallback. Rate limits
suggest lower-concurrency resume after the limit clears; disabled or suspended
accounts require restoring access with the selected provider instead.
If a provider failure overlaps cancellation or the run deadline, reports retain
the attempt failure and the separate run `stopReason`.

Before creating a run, review checks selected pairs against native model catalogs
without inference. Unsupported pairs return `invalid-input`; discovery/auth/host
failures return `environment-blocked`, both with exit 2 and no new run.
Catalog membership is not a provider-access guarantee. In particular, Claude's
review-time catalog includes the requested model, so its runtime identity check
cannot independently detect later provider withdrawal. No model fallback is used.

The root RC follows the strict versioned [configuration schema](https://github.com/GR34SE/degreaser-axi/blob/main/assets/schemas/config-v1.json). Unknown fields and explicitly selected disabled aspects are errors. See the [input contract](https://github.com/GR34SE/degreaser-axi/blob/main/assets/input-contract.md) for exact bounds, literal-path exclusions and Git representation limits.
In a built checkout or installed package, these are
`dist/assets/schemas/config-v1.json` and `dist/assets/input-contract.md`.

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
do not clip evidence. `usageScope: latest-attempt-per-aspect` labels usage from
each aspect's latest attempt, not a task/run total. Missing metadata is `unknown`,
including a resumed attempt that fails before returning it. Full reports retain
known usage in earlier attempt records and keep successful peers unchanged.

Pass `report <run-id>` or `finding F1 --run <run-id>` to read historical evidence;
otherwise reads select this repository's latest run. Reports of running reviews
return the current snapshot without waiting. Home reads history even without a
current RC. These read commands do not start reviews or modify local state.
Full reports separate configured identities from actual attempts and
coordinator-only applicability results, including A08 in repository audits.
When storage remains writable, a detached owner's fatal cause is saved with its
execution controls: prompt identity changes (`input-changed`) remain distinct
from unexpected owner failures (`owner-failed`). Reports show the latest cause;
`report --full` retains earlier execution causes after resume. A broken store
cannot reliably save its own failure and leaves the last committed evidence.

Results and progress are saved locally in ignored `.degreaser/`. Review context is sent through your chosen harness to its model provider. Degreaser does not apply fixes; your coding agent decides which findings warrant changes.

A representative one-aspect report excerpt:

```text
status: completed
evidence: source-only
scope: worktree
aspects: 1/1
count: 1
shown: 1
rejected: 0
```

For example, `finding F1` can quote `// Return the sum of two numbers.` and
explain why it repeats the function below it. The quote check establishes that
the code exists, not that the recommendation is correct. Zero findings is equally
valid. See [result validation and local data limits](https://github.com/GR34SE/degreaser-axi/blob/main/assets/result-contract.md),
also available at `dist/assets/result-contract.md` in a built checkout or
installed package.

Exit codes: **0** completed/no changes/already completed, **1** partial/failed/
interrupted, **2** invalid input/decision required/environment or state blocked,
**3** running. Findings alone do not cause a nonzero exit.

## Privacy and limitations

- Credentials stay in the native harness. Do not put tokens in the RC, task,
  model ID or command arguments. Worker environments exclude direct API-key and
  provider-routing overrides; no credential copying or automatic account fallback.
- Diagnostics keep selected identities, local paths, bounded numeric versions,
  failure categories and repair guidance, not raw exception payloads, native
  stderr, environment dumps, thoughts, full transcripts or tool logs. Unknown
  configuration keys/values are not echoed. This is not a general secret scanner.
- **Review data is intentionally not redacted.** Tasks, paths, patches, finding
  quotes and other evidence may contain sensitive code. `.degreaser/` stays local
  and ignored, but reports print that evidence. Inspect it before sharing.
  Native harness caches/history have their own retention rules.
- Review context reaches your selected model provider. Exclusions narrow assessed
  coverage, not worker read access. Ignored files may still be read as repository
  context. Use only repositories and providers you are authorized to review.
- Reviews are source-only, not tests, runtime verification or a guarantee of
  defect detection. Codex uses a read-only filesystem sandbox but retains shell/
  code mode for reads. Claude and Pi use native read-tool allowlists, not a
  universal OS no-exec sandbox. Host-managed policy still applies.
- Git clean filters can execute local commands during scope resolution. Binary
  contents and submodule contents are not reviewed as source. The resolved Git
  tree does not freeze live repository context; do not edit while reviewers run.
- All sixteen reviewers can consume substantial memory and subscription quota.
  Set `concurrency` for your machine/account. No silent model or harness switch
  occurs when access, quota or compatibility fails.
- v1 has no custom aspects, automatic fixes or registry self-update.

## Check a checkout

```sh
export DEGREASER_NODE24_MIN=/absolute/path/to/node-v24.0.0/bin/node
pnpm check
```

This runs deterministic tests, type checking, lint/format, build and a separate
local-tarball installation check on your current Node and exactly Node 24.0.0.
Supply a verified minimum-version executable; a missing runtime fails the check
rather than skipping it. It needs no model account.

The GitHub Actions workflow is configured to run this gate on macOS for pull requests and main.
The check is named `macOS deterministic`; live model tests are not part of it.
Local checks do not establish a hosted CI pass.

`pnpm qa` runs just the isolated init → review → report → partial failure →
same-run resume scenario. Its external adapter and faults are synthetic; the
compiled CLI, Git, owner and saved results are real. Live model reviews are
separate and consume your selected subscription quota.
