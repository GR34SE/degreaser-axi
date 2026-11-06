<p align="center">
  <img src="assets/branding/degreaser.png" alt="Degreaser — Removes slop!" width="760">
</p>

# Degreaser

Focused slop review for coding agents.

`degreaser-axi` looks at the change your coding agent just made. It runs sixteen small reviewers in parallel: one aspect each, a fresh context, evidence back. Your agent decides what to fix.

It does source-only reviews, waits on detached runs, cancels, resumes unchanged unresolved work, and reads saved reports. Init confirms the worker model and installs the startup integration and skill for the harnesses you pick.

- **The change, plus the repo** - Reviewers assess the diff and can follow callers, tests, dependencies and existing helpers.
- **One aspect per reviewer** - Sixteen focused reviews, each with examples of problems to report and justified code to keep.
- **Findings with quotes** - Location, quoted code, a concrete consequence, a checked counterargument and a direction. Reviewers only read.

```
change
  → degreaser-axi review    (sixteen isolated aspects)
  → findings with quotes
  → your coding agent decides
  → degreaser-axi dismiss   (when you keep the code)
```

## Quick Start

macOS, Node 24.0.0 or newer, Git, and an authenticated Codex, Claude Code or Pi login. Linux, Windows, Droid and Grok Build are out of v1. Model calls go through [acpx](https://github.com/openclaw/acpx) to a harness you already authenticated. Degreaser has no API keys of its own and does not fall back to paid keys.

Install it globally:

```sh
npm install -g degreaser-axi
degreaser-axi --version
```

Startup integrations call the installed executable, so run `init` from a stable install, not through `npx`. To try commands without installing, use `npx -y degreaser-axi --help`; the installed skill falls back to `npx -y degreaser-axi` when the command is not on PATH. `degreaser` is an alias of `degreaser-axi`. The examples use `degreaser-axi`.

From source (pnpm 12.14.0):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm link --global
```

Run the rest **inside the Git repository you want to review**. Init writes `.degreaserrc.json`, installs the selected integrations, and adds `/.degreaser/` to the root `.gitignore` without touching the index. `--aspects low-value-comments` is a cheap first review.

Workers currently need Codex ACP 2.5.0 with bundled Codex 0.165.0, Claude Code 2.1.317, or Pi 1.4.0. Claude and Pi must already be on PATH; Codex's worker executable ships with its pinned adapter. See [native worker restrictions and limits](https://github.com/GR34SE/degreaser-axi/blob/main/assets/native-profiles.md), or `dist/assets/native-profiles.md` in a built checkout or installed package.

```sh
degreaser-axi init
degreaser-axi review --scope worktree --task "Add CSV import with quoted-field support" --aspects low-value-comments
degreaser-axi report
```

## Init

In a terminal, Space selects agents and Enter confirms. Init detects Codex, Claude Code and Pi on PATH without starting them, then asks Project or Global. Pick the review agent, then press Enter on the highlighted model or type to search that agent's catalog. Only the selected review agent's catalog is loaded. If your previous model is no longer offered, init says so before you choose another.

Every init, including reinit, needs you to confirm or change the model. An existing RC prefills the last choice. Without a terminal, missing decisions return `decision-required` (exit 2) with exact candidates and example commands, and write nothing. After the user chooses, pass `--agent`, `--model` and `--harnesses`. The existing RC is not consent for a later invocation.

`--agent` is the reviewer harness; `--harnesses` are caller integrations. Pick only the ones you use.

```sh
degreaser-axi init --agent codex --model gpt-6-luna --harnesses codex,claude,pi
```

Init reads native catalogs without inference. The non-interactive response includes credential sources, not private account identities. Catalog entries do not guarantee later provider availability. Invalid choices or failed discovery never silently pick a replacement.

Init keeps other RC settings and installs both the startup integration and the skill for each selected harness. Installation defaults to the project; choose Global in the terminal or pass `--installation-scope user`. RC and ignore setup still belong to the current project. Nothing edits global permissions, Codex features/rules, or your AGENTS.md and CLAUDE.md.

## Integrations

Start a new harness session after installation (or reload Pi). Host trust and hook policy still apply. Codex 0.165.0 enables hooks by default but still requires project and hook trust. Approve through the host only if you trust the command; Degreaser never grants trust itself.

If something breaks later (updated harness, moved install, edited hooks), `degreaser-axi doctor` checks native versions and installed integrations without calling a model. To repair moved package paths or missing owned files:

```sh
degreaser-axi setup hooks --harnesses codex,claude,pi
```

Use your selected targets and the original scope. `--remove` drops only owned entries. Foreign settings stay intact; edited owned files produce a conflict instead of being overwritten. Keep your edits elsewhere, or restore the owned content, then retry.

Ownership receipts live in `.degreaser/integrations.json` at the selected project or home root. Codex and Pi share `.agents/skills/degreaser`, kept until both owners are removed.

Startup reads compact local context. It starts no models or reviews and is disabled in review workers. Missing executables or invalid local state do not block the host; use the CLI home view for state errors and `setup hooks` for repair.

Then invoke the skill:

- Claude Code: `/degreaser review my changes`
- Codex: `$degreaser review my changes`
- Pi: `/skill:degreaser review my changes`

Or ask in plain words:

> Run Degreaser on my current changes for the CSV import feature. Wait for the review, assess the findings, and fix the ones that apply.

For a feature branch, name its target:

> Review this branch against develop with Degreaser. The task was to add CSV import with quoted-field support.

The agent supplies the scope and task, starts the review, and waits before editing. Startup integrations make Degreaser discoverable; they do not launch reviews or call models on their own.

## Review from the CLI

```sh
# Current work: staged, unstaged and new non-ignored files.
degreaser-axi review --scope worktree --task "Add CSV import with quoted-field support"

# Feature branch, including local work, against an explicitly chosen target.
degreaser-axi review --scope branch --base develop --task "Add CSV import with quoted-field support"

# Whole-repository review is explicit and can cost more.
degreaser-axi review --scope repository --task "Review the repository for unnecessary complexity"

# Only part of the repository (or of a worktree/branch change).
degreaser-axi review --scope repository --path landing --path 'packages/*/src' --task "Audit the landing page"
```

Use `--task-file <path>` instead of `--task` for a longer brief. An empty diff finishes without starting reviewers.

Repeat `--path <pattern>` to assess only matching files in any scope. Patterns are relative to the Git root, wherever you run the command. A directory or file name such as `landing` or `landing/app/blog.ts` selects that file or everything beneath it; quoted globs (`*`, `**`, `?`, `[...]`) such as `'landing/**/*.tsx'` also work, and a matching directory includes its contents. `exclude` and the built-in exclusions still apply. A narrowed repository audit that matches no files fails without starting reviewers; a narrowed change with no matching files finishes as `no-changes`. Other files remain readable context.

If a review returns `running`, use the supplied `degreaser-axi wait <run-id>`. Keep the code unchanged until the run finishes. If some reviewers fail, completed peers stay available.

`review` and `wait` accept `--wait <seconds>` (default 480). A short wait returns `running` with exit 3, not success. A caller timeout or a killed waiting command does not stop the detached run: attach again with `wait`, not a replacement `review`. Repeated waits on a finished run only read its result.

### Cancel and resume

```sh
degreaser-axi cancel <run-id>
degreaser-axi resume <run-id>
```

Cancel signals the verified owner, stops queued work and retries, and waits for owned worker cleanup. Useful results and attempt history remain: cancellation returns `partial` or `failed` with exit 1. A run that finished first stays completed with exit 0. No permanent background service remains after cleanup. If cancel races ownership admission, it can return `run-busy` with exit 2: cancellation was **not applied**. Retry the supplied cancel command after admission finishes; the old terminal report does not confirm cancellation of resumed work.

Resume is for partial failure, cancellation or owner interruption. It rechecks source, task-file contents, resolved base, prompts and selected agent/model, then continues only unresolved aspects. An incomplete aspect continues with its unexamined files instead of starting over. Successful results stay intact, and earlier attempts (including incomplete evidence) remain in `report --full`. Changed input needs a new review. Unchanged completed runs return `already-completed` without starting anything.

Failure to check freshness is not proof that input changed. Git/configuration errors keep their diagnostics; unreadable task or packaged prompt files return `environment-blocked`. Repair access or the environment before retrying.

Resume accepts `--concurrency <n>` and `--wait <seconds>`. It keeps the original absolute deadline unless you pass `--deadline <seconds>`, which starts a new budget at the resumed owner's start. An expired deadline needs that override. Prefer these flags to editing an RC that is itself part of the reviewed source.

### Ownership

A live owner cannot be evicted just because its heartbeat is old. Recovery checks process birth identities and joins verified old work before replacement attempts. If a lock or PID is ambiguous, it refuses takeover rather than signalling unrelated processes. Follow the reported local inspection guidance; do not remove locks while an owner or worker is still active.

Reports mark interrupted active aspects as `interrupted`; full-report attempts are labeled `last-persisted` history, not proof that a worker is still running. Use the same Node executable as the original owner. For `owner-unverified`, inspect the run's `run.json` and `owner.lock` against local PID, start-time and process-group identities. Never signal a reused PID. If ownership remains unverifiable, keep the old evidence and start a new review only after confirming old work has stopped.

## What it looks for

All 16 aspects are enabled by default.

| Aspect | Review question |
| --- | --- |
| `missed-reuse` | Does the repo or an existing dependency already solve this? |
| `unnecessary-layers` | Does this wrapper, service or factory add useful behavior or a boundary? |
| `speculative-flexibility` | Do these options and extension points serve a current requirement? |
| `masked-errors` | Does a fallback turn failure into apparent success? |
| `unjustified-defense` | Does this check protect a real boundary or possible state? |
| `low-value-comments` | Does the comment explain something the code cannot? |
| `convention-drift` | Does this introduce another way to do the same thing without a reason? |
| `scope-creep` | Did the change add features or refactoring outside the task? |
| `contract-bypass` | Does a cast, suppression or default hide a real mismatch? |
| `low-value-tests` | Would this test detect broken behavior, or just confirm its own mock? |
| `incomplete-integration` | Is the new code connected to the real user path? |
| `wrong-abstraction` | Does a shared mechanism combine cases with conflicting rules? |
| `reinvented-infrastructure` | Does a handwritten cache, parser or similar mechanism miss required semantics? |
| `unidiomatic-code` | Can a native construct remove unnecessary logic without changing behavior? |
| `structural-erosion` | Does this change concentrate more responsibilities and branching in an overloaded unit? |
| `verification-theater` | Does a runtime or tooling check prove the property it claims to verify? |

A loop, wrapper, validation check or smoke test is not automatically slop. Reviewers have to establish a concrete problem in context, check reasons to keep the code, and treat zero findings as a valid result.

## Configure the review

Root `.degreaserrc.json` holds every configurable review setting, including defaults. Init writes the complete file after every explicit confirmation and keeps existing controls. You can disable built-in aspects, cap concurrency, or override the model for individual aspects.

A fresh init after selecting Codex and Luna writes:

```json
{
  "schemaVersion": 1,
  "agent": "codex",
  "model": "gpt-6-luna",
  "concurrency": null,
  "maxRetries": 1,
  "limits": {
    "workerTimeoutSeconds": 300,
    "workerIdleSeconds": 120,
    "maxTurns": 40,
    "runTimeoutSeconds": 900
  },
  "aspects": {
    "enable": ["missed-reuse", "unnecessary-layers", "speculative-flexibility", "masked-errors", "unjustified-defense", "low-value-comments", "convention-drift", "scope-creep", "contract-bypass", "low-value-tests", "incomplete-integration", "wrong-abstraction", "reinvented-infrastructure", "unidiomatic-code", "structural-erosion", "verification-theater"],
    "disable": [],
    "overrides": {}
  },
  "exclude": []
}
```

To disable an aspect, remove its ID from `enable` and add it to `disable`. `enable` affirms the default selection; it is not an allowlist. An ID cannot appear in both lists. Empty `overrides` means every aspect inherits the selected agent and model; `exclude` adds to the fixed built-in exclusions.

After upgrading the installed package:

```sh
degreaser-axi config sync
```

That fills only missing settings with the installed defaults, including nested settings, and reports what it added. Existing values (empty lists, zero retries, model overrides) stay. A complete file is left untouched. Sync does not discover models, install integrations or check the registry. Use `init` to create a missing RC and confirm the model and harnesses.

Older sparse files remain valid. Home/startup context, doctor and review responses list missing settings with their defaults and suggest `config sync`; those reads never rewrite the file or block review solely for missing defaults. Explicit values stay pinned when package defaults change. `schemaVersion` versions the format, not the package: adding a defaulted field does not bump it. Unsupported versions, unknown fields and invalid settings are rejected without rewriting the file. Sync currently completes format v1; it does not guess conversions for future incompatible formats.

`concurrency: null` means no cap; omitting it in older files means the same. Older binaries that reject RC null need upgrading before using a newly generated file.

Without a concurrency limit, all enabled aspects can run in parallel after the first model invocation. A lower limit reduces simultaneous calls; it does not reduce the number of aspects reviewed. Retries and continuation keep your selected harness and model. A model-only entry under `aspects.overrides.low-value-comments`, for example `{"model":"<exact-model-id>"}`, keeps the default agent. An agent override must also supply its compatible exact model.

Defaults: one extra retry, 300-second worker timeout, 120-second worker idle limit, 900-second run deadline, 40-turn budget. The idle limit stops an attempt that sends no events for that long, so a stuck worker retries early while an active one keeps its full timeout; running reports show each aspect's `lastActivity`. Configure `maxRetries` and `limits.workerTimeoutSeconds`, `limits.workerIdleSeconds`, `limits.runTimeoutSeconds`, `limits.maxTurns`. Only Claude enforces the turn budget natively; Codex and Pi treat it as advisory. `exclude` accepts literal repository-relative files or directory prefixes, not globs. For a one-run selection, use `review --path` instead.

Missing/malformed output, discarded oversized output and attempt timeouts get only the configured bounded retries in fresh sessions. Auth, model, account and rate-limit failures do not trigger automatic retries or fallback. Rate limits suggest lower-concurrency resume after the limit clears; disabled or suspended accounts need access restored with the selected provider. If a provider failure overlaps cancellation or the run deadline, reports keep the attempt failure and the separate run `stopReason`.

Before creating a run, review checks selected pairs against native model catalogs without inference. Unsupported pairs return `invalid-input`; discovery/auth/host failures return `environment-blocked`. Both are exit 2 and no new run. Catalog membership is not a provider-access guarantee. Claude's review-time catalog includes the requested model, so its runtime identity check cannot independently detect later provider withdrawal. No model fallback is used.

The root RC follows the strict versioned [configuration schema](https://github.com/GR34SE/degreaser-axi/blob/main/assets/schemas/config-v1.json). Unknown fields and explicitly selected disabled aspects are errors. See the [input contract](https://github.com/GR34SE/degreaser-axi/blob/main/assets/input-contract.md) for exact bounds, literal-path exclusions and Git representation limits. In a built checkout or installed package, these are `dist/assets/schemas/config-v1.json` and `dist/assets/input-contract.md`.

To review only specific aspects for one run, without changing configuration:

```sh
degreaser-axi review --scope worktree --task "Fix CSV parsing" --aspects missed-reuse,reinvented-infrastructure
```

## Read the results

The CLI follows [AXI](https://axi.md/): a short summary, details on demand, and a command for the next step.

```sh
degreaser-axi report          # Latest run and findings.
degreaser-axi report --full   # Full evidence.
degreaser-axi finding F1     # One finding from the latest run.
degreaser-axi export > r.json # Findings, coverage and limitations as JSON for other tools.
degreaser-axi doctor         # Local configuration/native-version diagnostics, no inference.
```

Each finding says what is wrong, where it occurs, why it matters and what would improve it. Incomplete reviews are marked explicitly. Reviewers inspect source; they do not run tests or claim runtime verification.

Large changes do not need to be split by hand. Each reviewer reports which changed files it examined. When files remain, Degreaser starts a fresh, focused session for the same aspect over only those files and merges the results. It repeats this while each session adds coverage. An aspect counts as clean or not applicable only when every readable changed file was examined. A large patch is stored as a plain diff with a line range per file, so reviewers read it file by file.

Short reports show at most 30 findings, with total/shown counts and per-aspect coverage, limitations and rejections. Overlapping locations on the same old/new side share a group but retain separate evidence. `report --full` and `finding` do not clip evidence. `usageScope: latest-attempt-per-aspect` labels usage from each aspect's latest attempt, not a task/run total. Missing metadata is `unknown`, including a resumed attempt that fails before returning it. Full reports retain known usage in earlier attempt records and keep successful peers unchanged.

Pass `report <run-id>` or `finding F1 --run <run-id>` to read historical evidence; otherwise reads select this repository's latest run. Reports of running reviews return the current snapshot without waiting. Home reads history even without a current RC. These read commands do not start reviews or modify local state.

When you decide not to apply a finding:

```sh
degreaser-axi dismiss F3 --reason "Kept for clients on the old API"
```

Later reviews that assess the same file pass dismissed findings and reasons to their reviewers, which should not raise the same issue again. Dismissals live in `degreaser/dismissed.json` inside the Git common directory (usually `.git/degreaser/`), so every worktree of the repository shares them and they are never committed. Edit or delete that file to undo a dismissal.

Full reports separate configured identities from actual attempts and coordinator-only applicability results, including scope-creep in repository audits. When storage remains writable, a detached owner's fatal cause is saved with its execution controls: prompt identity changes (`input-changed`) stay distinct from unexpected owner failures (`owner-failed`). Reports show the latest cause; `report --full` retains earlier execution causes after resume. A broken store cannot reliably save its own failure and leaves the last committed evidence.

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

For example, `finding F1` can quote `// Return the sum of two numbers.` and explain why it repeats the function below it. The quote check establishes that the code exists, not that the recommendation is correct. Zero findings is equally valid. See [result validation and local data limits](https://github.com/GR34SE/degreaser-axi/blob/main/assets/result-contract.md), also available at `dist/assets/result-contract.md` in a built checkout or installed package.

Exit codes: **0** completed/no changes/already completed, **1** partial/failed/interrupted, **2** invalid input/decision required/environment or state blocked, **3** running. Findings alone do not cause a nonzero exit.

## Privacy and limitations

- Credentials stay in the native harness. Do not put tokens in the RC, task, model ID or command arguments. Worker environments exclude direct API-key and provider-routing overrides; no credential copying or automatic account fallback.
- Diagnostics keep selected identities, local paths, bounded numeric versions, failure categories and repair guidance, not raw exception payloads, native stderr, environment dumps, thoughts, full transcripts or tool logs. Unknown configuration keys/values are not echoed. This is not a general secret scanner.
- **Review data is intentionally not redacted.** Tasks, paths, patches, finding quotes and other evidence may contain sensitive code. `.degreaser/` stays local and ignored, but reports print that evidence. Inspect it before sharing. Native harness caches/history have their own retention rules.
- Review context reaches your selected model provider. Exclusions narrow assessed coverage, not worker read access. Ignored files may still be read as repository context. Use only repositories and providers you are authorized to review.
- Reviews are source-only, not tests, runtime verification or a guarantee of defect detection. Codex uses a read-only filesystem sandbox but retains shell/code mode for reads. Claude and Pi use native read-tool allowlists, not a universal OS no-exec sandbox. Host-managed policy still applies.
- Git clean filters can execute local commands during scope resolution. Binary contents and submodule contents are not reviewed as source. The resolved Git tree does not freeze live repository context; do not edit while reviewers run.
- All sixteen reviewers can consume substantial memory and subscription quota. Set `concurrency` for your machine/account. No silent model or harness switch occurs when access, quota or compatibility fails.
- v1 has no custom aspects or automatic fixes.

## Check a checkout

```sh
export DEGREASER_NODE24_MIN=/absolute/path/to/node-v24.0.0/bin/node
pnpm check
```

This runs deterministic tests, type checking, lint/format, build and a separate local-tarball installation check on your current Node and exactly Node 24.0.0. Supply a verified minimum-version executable; a missing runtime fails the check rather than skipping it. It needs no model account.

The GitHub Actions workflow runs this gate on macOS for pull requests and main. The check is named `macOS deterministic`; live model tests are not part of it. Local checks do not establish a hosted CI pass.

`pnpm qa` runs just the isolated init → review → report → partial failure → same-run resume scenario. Its external adapter and faults are synthetic; the compiled CLI, Git, owner and saved results are real. Live model reviews are separate and consume your selected subscription quota.
