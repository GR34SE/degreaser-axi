# Configuration and resolved input, version 1

These are the input boundaries of the implemented source-only review engine.
Result completeness and local data limits are described in [result-contract.md](result-contract.md).

## Request

Review requires an explicit `worktree`, `branch` or `repository` scope and exactly one nonempty task, supplied as `--task` or a readable UTF-8 `--task-file`. File paths resolve from the invocation directory. Task text preserves whitespace and line breaks. Duplicate flags (other than repeatable `--path`), unknown flags, positional arguments, empty selections and noninteger controls fail before run creation. Only `branch` accepts `--base`, which is mandatory and never inferred.

The repository root comes from Git, including nested invocations and linked worktrees. Only its `.degreaserrc.json` is loaded. There is no parent-directory or global configuration search and no default agent/model.

## Configuration

[config-v1.json](https://github.com/GR34SE/degreaser-axi/blob/main/src/config/config.schema.json) is a strict draft-07 JSON Schema. An omitted `schemaVersion` means version 1, keeping the minimal `{ "agent": "codex", "model": "<exact-id>" }` form valid. Explicit unsupported versions and unknown fields at any depth are errors. No values are coerced.

- Agents: `codex`, `claude`, `pi`, `cursor`. Models are whitespace-free IDs or explicit latest selectors (below), with `provider/model` required for Pi. Syntax checks do not establish model availability. Before creating a run, owner or aspect attempt, `review` discovers the exact catalogs needed by selected workers and rejects unsupported pairs (including overrides) as `invalid-input` / 2. Exact IDs never receive prefix matching, substitution or fallback.
- `aspects` maps each built-in ID to exactly one setting: `true` (on, configured identity), `false` (off) or an identity object (on, that identity). Omitted IDs are on. Unknown IDs, other value types or an empty effective selection are invalid.
- `--aspects` is a comma-separated one-run subset of enabled IDs, sorted into catalog order. Explicit disabled IDs are errors, not silently re-enabled. No aliases (including former A01–A16 numbers) or custom rubrics.
- An identity object is `{ "model": "<exact-id>" }` or `{ "agent": "...", "model": "..." }`. Model-only overrides retain the configured agent; an agent override always requires an explicit model.
- `concurrency` and `limits.maxTurns` accept integers 1–9,007,199,254,740,991. An absent concurrency limit means all selected workers, not a machine-dependent cap. RC `null` explicitly represents no limit, as it does in resolved input.
- `maxRetries`: 0–10, default 1 additional attempt. `limits.workerTimeoutSeconds`: 1–2,147,483, default 300. `limits.workerIdleSeconds`: the same range, default 120; an attempt with no adapter event for that long stops as a timeout. `limits.runTimeoutSeconds`: the same range, default 900. `limits.maxTurns` defaults to 40. `--wait` uses the seconds range, default 480. The seconds bound prevents signed 32-bit millisecond timer overflow.
- Only `--aspects`, `--concurrency` and `--wait` control this review invocation. They never rewrite the RC.

Init writes every configurable field, including every aspect, empty collections and explicit null concurrency. `config sync` fills only missing fields (including nested limits and aspect settings) in an existing valid RC, retaining explicit values and effective behavior. It writes atomically and leaves complete files untouched. Model-only overrides continue inheriting the configured agent; sync does not copy inherited identities into overrides. Home, installed startup hooks, doctor and review disclose missing settings and the installed default values without editing the RC. No registry lookup or model discovery is needed to sync. The format version is independent of package releases; unsupported versions and unknown fields are errors, never reset or silently discarded.

These numeric defaults, retry ceiling, version-omission rule and exclusion spelling are implementation choices, not additional product requirements.

Model discovery uses the same restricted native profiles and environment as workers, with no prompt or model-setting RPC. Each distinct selected identity is inspected once. Claude discovery omits the native model flag so an arbitrary requested ID cannot add itself to the catalog. Pi discovery omits provider/model selection so an unsupported requested pair cannot prevent its native metadata API from returning the independent configured catalog. A native default may appear in metadata, but it is never used for a review turn or saved as a new default. Metadata sessions may create native harness history, but never Degreaser run history or aspect attempts. Discovery is bounded to at most 120 seconds per identity (or the shorter worker timeout), plus native version checks and joined cleanup. Missing metadata or failed discovery, including auth or host faults, returns `environment-blocked` / 2, not automatic acceptance or an inferred invalid model.

Invalid syntax fails before discovery. Empty change scopes and coordinator-only scope-creep repository audits need no catalog or reviewer. Identity objects of aspects not selected for the run are syntax-checked but do not trigger discovery. Actual review sessions retain exact argv selection and check the advertised catalog and selected identity before inference. A missing entry or selection mismatch fails as `model-unavailable`, without fallback or blind retry. These are metadata checks, not proof of provider access or future availability. In particular, Claude's review-time `--model` adds the requested ID to its advertised catalog, so that runtime check cannot independently detect provider withdrawal. Provider/auth failures can still occur when a turn starts. Pi's offline startup catalog may also be cached; no preflight predicts future provider availability.

### Latest models and version pins

`init` puts choices labeled `(latest)` above versioned IDs and prefers them
when recommending the same model family. Existing configurations and explicit
flags remain prefill; init never silently migrates a version pin.

- **Claude Code:** select an advertised `sonnet`, `opus`, `haiku` or `fable`
  alias, displayed as e.g. `sonnet (latest)`. The RC saves `sonnet`, not the
  version it currently points to. Claude Code resolves it at launch. Its native
  version, provider availability and managed policy determine when a new model
  becomes available. Keep Claude Code current to pick up alias updates.
- **Codex:** select e.g. `luna (latest)` or `sol (latest)`. The RC saves
  `latest:luna` or `latest:sol`. Before each new review, Degreaser selects the
  highest numeric GPT version in that exact family from the adapter's advertised
  catalog, without changing the RC. For example `gpt-6.10-luna` wins over
  `gpt-6.9-luna`; a newer Sol never replaces Luna. Families derive from
  `gpt-<version>-<family>` IDs; plain `gpt-<version>` uses `latest:gpt`.
  Variant suffixes stay separate families.

Codex latest selectors work at the top level and in aspect overrides. Resolved
assignments save the exact model plus `requestedModel` (the latest selector).
All attempts and resumes of that run keep that exact model, even if the catalog
later adds a newer one. A changed selector requires a new review; a withdrawn
model fails instead of switching a resumed run. Native Claude aliases remain
aliases within a run; Degreaser does not claim to freeze their provider-side
resolution. Choose a full versioned ID for that guarantee.

These choices follow the installed harness's catalog or alias, not all announced
models worldwide. Cached catalogs, an older harness, access restrictions or an
unavailable provider can delay updates. No option guarantees access on release
day. Degreaser does not install updates, change accounts or fall back to paid APIs.

### Complete configuration example

Example with Codex and `gpt-6-luna`; confirm the exact model available in your native catalog during `init`.

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
    "unnecessary-complexity": true,
    "masked-errors": true,
    "verification-theater": true,
    "contract-bypass": true,
    "incomplete-integration": true,
    "low-value-tests": true,
    "scope-creep": true,
    "reinvented-infrastructure": true,
    "missed-reuse": true,
    "wrong-abstraction": true,
    "structural-erosion": true,
    "speculative-flexibility": true,
    "unnecessary-layers": true,
    "unjustified-defense": true,
    "convention-drift": true,
    "unidiomatic-code": true,
    "low-value-comments": true
  },
  "exclude": []
}
```

## Assessed paths and exclusions

`exclude` is a list of **literal repository-relative file names or directory prefixes**, for example `["vendor", "package-lock.json", "src/generated"]`. No leading/trailing slash, `.`/`..` components, backslashes, negation or glob syntax. Entries are never interpreted as Git pathspecs. `vendor` also excludes `vendor/file`, but not `vendor-other`.

`review --path <pattern>` is a repeatable one-run selection for every scope. Patterns are Git-root-relative regardless of the invocation directory. Each pattern selects paths it matches as a Git `:(top,glob)` pathspec, everything beneath a matched directory, and the literal path as written (so `app/[slug]` works). `landing` selects everything under `landing/`; `*`, `?` and `[...]` do not cross `/`; `**/` matches any number of directories (`'landing/**/*.tsx'`); `'packages/*/src'` selects everything under each matching `src`. Empty patterns, a leading `/` or `:`, empty (including trailing), `.` or `..` components, backslashes, NUL and duplicate patterns are `invalid-input` before run creation; users cannot supply other pathspec magic. Selection composes with exclusions: built-ins and `exclude` still remove matching files, and `excludedPaths` lists only selected omissions. A selected repository audit with no assessable files is `invalid-input` naming the patterns, with no run or reviewer. A selected worktree/branch scope whose change set is non-empty but has no matching assessable changed file is `invalid-input` / 2 naming the patterns (a typo must not look like a clean review); an empty change set stays `no-changes` with or without `--path`. Resolved input records the patterns as `pathPatterns` (absent when unselected) plus a `path-selection` limitation; they are part of review identity, so resume treats different patterns as different input. Unselected files remain readable context, not reviewed coverage.

Built-ins always exclude root `.degreaser` and directories named `node_modules`, `dist`, `build` or `coverage` at any depth, with everything beneath them. A file with one of those names (`scripts/build`, `internal/dist`) is a normal assessable path. They cannot be re-enabled. Git-ignored untracked files are not collected. Already tracked ignored files remain eligible except for these assessed-path exclusions. A rename crossing a coverage boundary follows Git's filtered comparison, appearing as an addition or deletion where appropriate.

Exclusions restrict assessed coverage, not read access. Reading an excluded manifest as context does not mean it was reviewed. The resolved tree may contain excluded contextual files; root `.degreaser` is removed even when tracked. `excludedPaths` reports omitted changed paths (or omitted tree paths for an audit), not a registry of contextual reads.

## Git representation

- **Worktree:** HEAD to final working contents, combining staged, unstaged and nonignored new files. A staged edit reversed on disk disappears. Without HEAD, the base is an empty tree.
- **Branch:** the unique merge-base of HEAD and the explicit available base commit, through feature commits and final local contents. No HEAD, an invalid ref, unresolved index conflicts, unrelated/missing history or multiple merge-bases fails without fetch, guessed bases or repairs.
- **Repository:** an explicit audit path list from the resolved final tree. `base` and `patch` are `null`, not an invented empty-tree change. scope-creep gets a coordinator `not-applicable` result with the no-feature-change-scope reason, never a worker, even in a scope-creep-only audit.

One temporary index produces one final tree, built by one recursive `git add` of the repository root; untracked root `.degreaser` run state is kept out of it. The coordinator uses Git's NUL-delimited path/metadata formats, literal exclusion pathspecs (plus the `--path` selection above), tree IDs, blob IDs and patches, not a custom diff algorithm. It clears assume-unchanged/skip-worktree flags only in the copy and supports split indices. Git hooks and filesystem monitors are disabled per command; inherited Git routing variables are not used. Diff helpers/textconv/color are disabled, with explicit prefixes, Myers diff, three context lines and 50% similarity rename detection. Temporary files are removed on success or failure.

The primitive writes Git objects. It does not stage into the user's index, move refs, checkout files or edit source. Local clean filters can execute commands and transform contents, including LFS pointers. This is not a sandbox for those user-configured commands. The caller must trust their Git filters.

Binary contents are not supplied as text evidence. Submodules are only gitlinks; nested/dirty content is not assessed. Filtered blobs may differ from live files. Rename detection is similarity-based. Relevant limitations and paths accompany the resolved input. Sparse checkout is rejected rather than pretending absent paths are deletions. Non-UTF-8 path names and Git metadata are rejected rather than persisted with replacement characters. A changed file whose text contents are not valid UTF-8 (such as Latin-1) is treated like a binary file: its section is replaced by a binary stub in the patch, it is marked binary, excluded from required coverage and disclosed in a `non-utf8` limitation, while other files are reviewed normally. Git commands have a 30-second timeout and a 64 MiB output bound; exceeding either is an explicit failure, never truncated coverage.

## Persistence boundary

[input-v1.json](https://github.com/GR34SE/degreaser-axi/blob/main/src/review/input.schema.json) describes the serializable resolved input: repository, scope, explicit base reference, optional path patterns, resolved base/tree, task, effective execution identities/settings, assessed path records, exclusions, patch, limitations, worker assignments and coordinator results. Path records retain old/new blob IDs and modes, rename source/destination, and binary markers. For a side with Git mode `120000` (symbolic link) the record also holds the target text from the resolved blob as `oldLink` / `newLink`; it is also shown to workers. The link itself is the assessed entry, never the target: its evidence coordinate is line 1 of that blob, quotes validate against it, and nothing follows the link, so missing, external or directory targets are not read. It is readable for coverage like any text path. A target that is not valid UTF-8 follows the non-UTF-8 rule above. JSON preserves newline/tab/Unicode paths without line-splitting ambiguity.

`prepareReview` computes this input but creates no run or model session. `createRun` validates it against the shipped schema before persistence; `loadInput` validates the schema and recorded identity when reading it. The owner retains that resolved input for all workers, adding assembled-prompt identity when that prompt exists. `ready` is an internal admission status, not a public completed review. `no-changes` has no workers and does not certify clean code or become an audit.

The tree is neither a copy of the repository nor an atomic snapshot. Callers must not edit during review; live context, ignored dependencies and external state remain unfrozen. Git may eventually prune unreferenced objects. State/evidence handling must fail explicitly if historical blobs are unavailable, not substitute live contents. Task/patch/blob evidence can contain sensitive code and belongs only in local ignored run artifacts, not diagnostic logs.

When reading a saved run, the raw `input/patch.diff` used by workers must match the persisted patch exactly. Missing or changed bytes fail as corrupt state; no worker is dispatched from that input.
