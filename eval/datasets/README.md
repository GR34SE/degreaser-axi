# Source-backed dataset derivation

Development-only, deterministic ingestion. This does not invoke a model, run
downloaded code, execute source tests or make manual quality assessments.
Downloaded inputs and generated repositories are never package resources.

```sh
pnpm eval:derive -- --output "$NEW_IGNORED_OUTPUT_DIRECTORY"
pnpm eval:derive -- --source swe-refactor --source simplibench \
  --source-root "$SOURCE_COLLECTION" --output "$NEW_IGNORED_OUTPUT_DIRECTORY"
```

Without `--source`, only `self` is derived and no source collection is needed
(self reads the Git checkout). `--source-root` is required for any other
source; its layout is the downloaded collection's `INDEX.md` layout.
Output must be new, outside the source collection, with an existing parent.
`eval/.generated/` is ignored and excluded from development checks; use a new
child such as `eval/.generated/datasets` for each run.
`--source` is repeatable: `self` (default), `swe-refactor`, `simplibench`, `cleanup-pr`.
`--self-repo` selects the local checkout holding the pinned self revisions
(default: this checkout); a missing revision fails with a fetch instruction.
`--contrasts` (default off) adds the self instruction and scope variants. They
are related observations in the one self cluster, not independent samples, and
quadruple the self samples and their planned worker sessions. No source
checkout, user index, refs or configuration is modified.
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

- **Self:** the pinned before revision `b4a1ede` is compared with the owner
  cleanup accepted on main, `d232af8`. A fully deleted lexical comment block
  is a REPORT anchor; deleted code is not a comment label. Consecutive line
  comments and block comments are one issue. A comment block that lies entirely
  outside every old-side diff range of its file and is unchanged in `d232af8`
  is a PRESERVE anchor (`<path>:keep:<start>-<end>`, before-side lines), in
  any `.ts`-family file present in both revisions, including files without a
  diff. The owner's cleanup was exhaustive, so kept comments are source-backed
  negatives; all other surviving comments remain unknown.
  `test/live/support/comment-fixtures.ts` holds deliberately low-value
  comments as test fixtures, so it yields neither REPORT nor PRESERVE.
  Samples are directory groups (`self/comments/<group>/...`) whose `paths`
  include files carrying only PRESERVE anchors. Each group is assigned by a
  fixed hash to `dev` (about 70%) or `regression`; the cluster stays
  `repository:degreaser-axi`. `self-whole/comments/whole-repository`
  (family `self-whole`, split `regression`, scope `repository`, `paths: []`
  meaning the whole repository) carries the union of all self anchors and
  measures the whole-repository audit regime. The opt-in
  H1 contrast retains/removes the original root `AGENTS.md`; the other
  contrast uses repository scope versus the original parent's source-projected
  branch scope. All variants remain in the self cluster.
- **SWE-Refactor:** reads the original whole-file before text and localizes
  its unique before-method snippet. The mixed old/new `diffLocations` are
  deliberately not used. `types.json` explicitly lists accepted aspect
  alternatives for every supported refactoring type. `Move Method`, `Move And
  Rename Method`, `Extract And Move Method` and `Move And Inline Method` are
  skipped as `needs-cross-file-context`: the worker sees only the single
  before file, so the destination cannot be judged. Missing or ambiguous
  snippets are excluded, not assigned guessed ranges.
- **SimpliBench:** tagged and untagged small/test rows are paired once.
  Removing only localization markers must reproduce the raw source exactly.
  Workers receive only untagged before text, never tags or after text. Physical
  line coordinates are preserved: overlapping fragments on a single line
  collapse to one coarse anchor. The export is mostly single-line files, so an
  anchor is file-level (line 1) and any finding on it counts. No formatter
  invents line-level precision.
- **Cleanup PRs:** only merged, non-restoration changes with at most 100 changed
  files are eligible. Added/renamed files, tests/generated/non-source files,
  missing before text, pure additions and changes over 120 old lines per file
  are excluded. Binary/large context and Git attribute/submodule controls are
  omitted with reasons. Labels use Git-computed old-side hunks from API
  base/head snapshots. These are **not verified upstream merge-base diffs**.
  The reviewed repository contains the API base snapshot, not the cleanup.

Accepted refactorings and PR changes are **change proxies, not verified slop**.
Unmatched findings remain proxy measurements. Outside self's PRESERVE rule,
untouched source is unknown, never a hard negative. The other derivatives supply
neither PRESERVE anchors nor fabricated forbidden-direction sentinels. Empty safety denominators are missing
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
