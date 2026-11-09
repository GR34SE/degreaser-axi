# Source-backed dataset derivation

Development-only, deterministic ingestion. This does not invoke a model, run
downloaded code, execute source tests or make manual quality assessments.
Downloaded inputs and generated repositories are never package resources.

```sh
node eval/datasets/derive.mjs derive \
  --source-root "$SOURCE_COLLECTION" \
  --output-dir "$NEW_IGNORED_OUTPUT_DIRECTORY"
```

The collection layout is the downloaded collection's `INDEX.md` layout.
Output must be new, outside the source collection, with an existing parent.
`eval/.generated/` is ignored and excluded from development checks; use a new
child such as `eval/.generated/datasets` for each run.
`--source` is repeatable: `self`, `swe-refactor`, `simplibench`, `cleanup-pr`.
`--self-repo` selects the local checkout holding the pinned self revisions.
`--no-contrasts` retains only the instruction-bearing repository-scope self
samples. No source checkout, user index, refs or configuration is modified.
Generated snapshot commits use the already-configured Git identity.

```js
import { deriveDatasets } from "./derive.mjs";

const { samples, receipt } = await deriveDatasets({
  sourceRoot,
  outputDir,
  // selfRepo, sources, contrasts are optional.
});
```

The return value is `{ samples, receipt }`. Output contains `samples.jsonl`,
materialized Git repositories under `repos/`, and `receipt.json`. The receipt
records full input-file SHA-256s, pinned source revisions, mapping identity,
raw counts and deterministic exclusions. `portableSamplesSha256` excludes
generated absolute repository paths; it still includes materialized Git
identities, so a different configured author changes that checksum.

## Label semantics

- **Self:** the pinned before revision is compared with the pinned owner
  cleanup. Only fully deleted lexical comment blocks become REPORT anchors;
  deleted code is not a comment label. Consecutive line comments and block
  comments are issues, not independent lines. Surviving comments remain unknown,
  not PRESERVE anchors. The optional
  H1 contrast retains/removes the original root `AGENTS.md`; the other
  contrast uses repository scope versus the original parent's source-projected
  branch scope. All variants remain in the self development cluster.
- **SWE-Refactor:** reads the original whole-file before text and localizes
  its unique before-method snippet. The mixed old/new `diffLocations` are
  deliberately not used. `types.json` explicitly lists accepted aspect
  alternatives for every supported refactoring type. Missing or ambiguous
  snippets are excluded, not assigned guessed ranges.
- **SimpliBench:** tagged and untagged small/test rows are paired once.
  Removing only localization markers must reproduce the raw source exactly.
  Workers receive only untagged before text, never tags or after text. Physical
  line coordinates are preserved: overlapping fragments on a single line
  collapse to one coarse anchor. No formatter invents line-level precision.
- **Cleanup PRs:** only merged, non-restoration changes with at most 100 changed
  files are eligible. Added/renamed files, tests/generated/non-source files,
  missing before text, pure additions and changes over 120 old lines per file
  are excluded. Binary/large context and Git attribute/submodule controls are
  omitted with reasons. Labels use Git-computed old-side hunks from API
  base/head snapshots. These are **not verified upstream merge-base diffs**.
  The reviewed repository contains the API base snapshot, not the cleanup.

Accepted refactorings and PR changes are **change proxies, not verified slop**.
Unmatched findings remain proxy measurements. Untouched source is unknown,
never a hard negative. These derivatives supply neither PRESERVE anchors nor
fabricated forbidden-direction sentinels. Empty safety denominators are missing
evidence, not a perfect safety score or a release-readiness claim.

Samples add `cluster` and optional `contrast` metadata to the shared contract.
SWE projects and PR repositories are split as whole clusters using a fixed
hash rule. The SimpliBench export lacks repository identities, so its entire
population stays in holdout; unknown cross-corpus origin overlap cannot be
proven absent. Receipts expose omissions rather than implying full-project
or runtime verification.

Ingestion rejects traversal, absolute/control-character paths, Git internals,
symlinks and non-regular snapshot entries. Git objects are created without
archive templates, hooks, checkout filters or executing downloaded scripts.
