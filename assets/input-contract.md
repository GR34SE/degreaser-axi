# Configuration and resolved input, version 1

These are the input boundaries of the implemented source-only review engine.
Result completeness and local data limits are described in [result-contract.md](result-contract.md).

## Request

Review requires an explicit `worktree`, `branch` or `repository` scope and exactly one nonempty task, supplied as `--task` or a readable UTF-8 `--task-file`. File paths resolve from the invocation directory. Task text preserves whitespace and line breaks. Duplicate flags, unknown flags, positional arguments, empty selections and noninteger controls fail before run creation. Only `branch` accepts `--base`, which is mandatory and never inferred.

The repository root comes from Git, including nested invocations and linked worktrees. Only its `.degreaserrc.json` is loaded. There is no parent-directory or global configuration search and no default agent/model.

## Configuration

[config-v1.json](schemas/config-v1.json) is a strict draft-07 JSON Schema. An omitted `schemaVersion` means version 1, keeping the minimal `{ "agent": "codex", "model": "<exact-id>" }` form valid. Explicit unsupported versions and unknown fields at any depth are errors. No values are coerced.

- Agents: `codex`, `claude`, `pi`. Models are exact, whitespace-free IDs, with `provider/model` required for Pi. Syntax checks do not establish model availability. Before creating a run, owner or aspect attempt, `review` discovers the exact catalogs needed by selected workers and rejects unsupported pairs (including overrides) as `invalid-input` / 2. No prefix matching, substitution or fallback.
- All A01–A16 start enabled. `aspects.disable` removes IDs; `aspects.enable` explicitly affirms IDs from that default, not an allowlist. An ID in both lists, duplicate/unknown IDs or an empty effective selection is invalid.
- `--aspects` is a comma-separated one-run subset of enabled IDs, sorted into catalog order. Explicit disabled IDs are errors, not silently re-enabled. No slugs or custom rubrics.
- `aspects.overrides` maps built-in IDs to `{ "model": "<exact-id>" }` or `{ "agent": "...", "model": "..." }`. Model-only overrides retain the configured agent; an agent override always requires an explicit model.
- `concurrency` and `limits.maxTurns` accept integers 1–9,007,199,254,740,991. An absent concurrency limit means all selected workers, not a machine-dependent cap. RC `null` explicitly represents no limit, as it does in resolved input.
- `maxRetries`: 0–10, default 1 additional attempt. `limits.workerTimeoutSeconds`: 1–2,147,483, default 300. `limits.runTimeoutSeconds`: the same range, default 900. `limits.maxTurns` defaults to 40. `--wait` uses the seconds range, default 480. The seconds bound prevents signed 32-bit millisecond timer overflow.
- Only `--aspects`, `--concurrency` and `--wait` control this review invocation. They never rewrite the RC.

Init writes every configurable field, including defaults, empty collections and explicit null concurrency. `config sync` fills only missing fields (including nested limits and aspect settings) in an existing valid RC, retaining explicit values and effective behavior. It writes atomically and leaves complete files untouched. Model-only overrides continue inheriting the configured agent; sync does not copy inherited identities into overrides. Home, doctor and review disclose missing settings and the installed default values without editing the RC. No registry lookup or model discovery is needed to sync. The format version is independent of package releases; unsupported versions and unknown fields are errors, never reset or silently discarded.

These numeric defaults, retry ceiling, version-omission rule and exclusion spelling are implementation choices, not additional product requirements.

Model discovery uses the same restricted native profiles and environment as workers, with no prompt or model-setting RPC. Each distinct selected identity is inspected once. Claude discovery omits the native model flag so an arbitrary requested ID cannot add itself to the catalog. Pi discovery omits provider/model selection so an unsupported requested pair cannot prevent its native metadata API from returning the independent configured catalog. A native default may appear in metadata, but it is never used for a review turn or saved as a new default. Metadata sessions may create native harness history, but never Degreaser run history or aspect attempts. Discovery is bounded to at most 120 seconds per identity (or the shorter worker timeout), plus native version checks and joined cleanup. Missing metadata or failed discovery, including auth or host faults, returns `environment-blocked` / 2, not automatic acceptance or an inferred invalid model.

Invalid syntax fails before discovery. Empty change scopes and coordinator-only A08 repository audits need no catalog or reviewer. Unselected overrides are syntax-checked but do not trigger discovery. Actual review sessions retain exact argv selection and check the advertised catalog and selected identity before inference. A missing entry or selection mismatch fails as `model-unavailable`, without fallback or blind retry. These are metadata checks, not proof of provider access or future availability. In particular, Claude's review-time `--model` adds the requested ID to its advertised catalog, so that runtime check cannot independently detect provider withdrawal. Provider/auth failures can still occur when a turn starts. Pi's offline startup catalog may also be cached; no preflight predicts future provider availability.

## Assessed paths and exclusions

`exclude` is a list of **literal repository-relative file names or directory prefixes**, for example `["vendor", "package-lock.json", "src/generated"]`. No leading/trailing slash, `.`/`..` components, backslashes, negation or glob syntax. Entries are never interpreted as Git pathspecs. `vendor` also excludes `vendor/file`, but not `vendor-other`. There is no additional path-selector flag.

Built-ins always exclude root `.degreaser` and components named `node_modules`, `dist`, `build` or `coverage` at any depth. They cannot be re-enabled. Git-ignored untracked files are not collected. Already tracked ignored files remain eligible except for these assessed-path exclusions. A rename crossing a coverage boundary follows Git's filtered comparison, appearing as an addition or deletion where appropriate.

Exclusions restrict assessed coverage, not read access. Reading an excluded manifest as context does not mean it was reviewed. The resolved tree may contain excluded contextual files; root `.degreaser` is removed even when tracked. `excludedPaths` reports omitted changed paths (or omitted tree paths for an audit), not a registry of contextual reads.

## Git representation

- **Worktree:** HEAD to final working contents, combining staged, unstaged and nonignored new files. A staged edit reversed on disk disappears. Without HEAD, the base is an empty tree.
- **Branch:** the unique merge-base of HEAD and the explicit available base commit, through feature commits and final local contents. No HEAD, an invalid ref, unresolved index conflicts, unrelated/missing history or multiple merge-bases fails without fetch, guessed bases or repairs.
- **Repository:** an explicit audit path list from the resolved final tree. `base` and `patch` are `null`, not an invented empty-tree change. A08 gets a coordinator `not-applicable` result with the no-feature-change-scope reason, never a worker, even in an A08-only audit.

One temporary index produces one final tree. The coordinator uses Git's NUL-delimited path/metadata formats, literal input pathspecs, tree IDs, blob IDs and patches, not a custom diff algorithm. It clears assume-unchanged/skip-worktree flags only in the copy and supports split indices. Git hooks and filesystem monitors are disabled per command; inherited Git routing variables are not used. Diff helpers/textconv/color are disabled, with explicit prefixes, Myers diff, three context lines and 50% similarity rename detection. Temporary files are removed on success or failure.

The primitive writes Git objects. It does not stage into the user's index, move refs, checkout files or edit source. Local clean filters can execute commands and transform contents, including LFS pointers. This is not a sandbox for those user-configured commands. The caller must trust their Git filters.

Binary contents are not supplied as text evidence. Submodules are only gitlinks; nested/dirty content is not assessed. Filtered blobs may differ from live files. Rename detection is similarity-based. Relevant limitations and paths accompany the resolved input. Sparse checkout is rejected rather than pretending absent paths are deletions. Non-UTF-8 path/patch output is rejected rather than persisted with replacement characters. Git commands have a 30-second timeout and a 64 MiB output bound; exceeding either is an explicit failure, never truncated coverage.

## Persistence boundary

[input-v1.json](schemas/input-v1.json) describes the serializable resolved input: repository, scope, explicit base reference, resolved base/tree, task, effective execution identities/settings, assessed path records, exclusions, patch, limitations, worker assignments and coordinator results. Path records retain old/new blob IDs and modes, rename source/destination, and binary markers. JSON preserves newline/tab/Unicode paths without line-splitting ambiguity.

`prepareReview` computes this input but creates no run or model session. The owner must validate it with `validateReviewInput` before persistence and after reading it, retain the resolved input for all workers, and add assembled-prompt identity when that prompt exists. `ready` is an internal admission status, not a public completed review. `no-changes` has no workers and does not certify clean code or become an audit.

The tree is neither a copy of the repository nor an atomic snapshot. Callers must not edit during review; live context, ignored dependencies and external state remain unfrozen. Git may eventually prune unreferenced objects. State/evidence handling must fail explicitly if historical blobs are unavailable, not substitute live contents. Task/patch/blob evidence can contain sensitive code and belongs only in local ignored run artifacts, not diagnostic logs.
