# Evaluation and improvement

Development-only, source-backed evaluation of how well review workers find
slop. Claude Haiku remains the owner's fixed worker recommendation. No manual
grading, model judge, production dependency, or model inference in CI.

## The improvement loop

```sh
pnpm build
pnpm eval:derive -- --output eval/.generated/datasets                    # 1. labels
pnpm eval -- --samples eval/.generated/datasets/samples.jsonl --split all \
  --model <exact-haiku-id> --repeat 1 --output eval/.generated/baseline \
  --allow-models                                                         # 2. baseline
# 3. read eval/.generated/baseline/summary.md and pick ONE surface
# 4. edit that surface in a separate checkout and run pnpm build there
pnpm eval -- --samples eval/.generated/baseline/samples.jsonl --split all \
  --product <candidate-checkout> --model <exact-haiku-id> --repeat 1 \
  --output eval/.generated/candidate --allow-models                      # 5. candidate
pnpm eval:gate -- --baseline eval/.generated/baseline/records.jsonl \
  --candidate eval/.generated/candidate/records.jsonl --mode improvement \
  --output eval/results/<date>-<surface>.json                            # 6. verdict
```

Steps 2 and 5 spend Haiku sessions; without `--allow-models` they print the
plan only. `--split all` is 72 reviews (at most 144 sessions with the fixed
retry). Confirm the exact Haiku ID and native login/quota first. There is no
paid API, account or model fallback. `--budget` rejects a plan whose worst-case
session count exceeds it; it does not bound tokens or wall-clock time.

Step 3 decides what to change. `summary.md` reports recall with and without
evidence locations, how often kept comments were flagged, the labels missed in
every repetition, and the hit rate by review size, file length, position and
label length. Its diagnosis section names the likely surface:

| Signal                                             | Change                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| recall far above `recallPrimary`                   | nothing: the worker groups findings            |
| hit rate falls with paths, file length, whole repo | coverage or budget in the product, not wording |
| low recall without those drops                     | the aspect rubric                              |
| kept comments flagged                              | the rubric over-reports                        |

The diagnosis is a heuristic for where to look, not proof of cause.

Step 4 may iterate on `--split dev` only. Step 6 compares the same frozen
samples, including the `regression` split that step 4 must not consult.
`passed` with `--mode improvement` means recall is measurably better and
neither kept-comment retention nor completeness regressed beyond its margin.
A rubric change still merges through ordinary code review. Commit the redacted
receipt. A new owner cleanup commit for another aspect extends the labels by
adding its pinned revisions to `eval/datasets/self.mjs`.

## Data

`pnpm eval:derive` labels this repository's own cleanup `b4a1ede` → `d232af8`:
comments the owner removed are REPORT, comments the owner kept unchanged are
PRESERVE. It needs no downloaded data and runs no model; see
[datasets](datasets/README.md). Do not commit its output. Only
`low-value-comments` has recall evidence today.

## Runs

Each review runs the built public CLI in an isolated copy of the sample and
waits for its terminal result. Gold labels stay outside the worker repository.
The run directory holds the frozen `samples.jsonl`, `manifest.json`,
`records.jsonl` (appended as each review ends), `summary.json` and
`summary.md`. An interrupt cancels running reviews, records the rest as
interrupted and still writes the summary. There is no resume: rerun into a new
directory. Do not edit materialized input or labels between baseline and
candidate.

A `partial` review counts as worker quality only when every unresolved
aspect's last attempt ended in invalid output, the output limit, or a valid
incomplete result. Authentication, quota, model, network, cleanup or ambiguous
timeout causes are provider errors, not evidence about the candidate. The
command exits 1 when any record is an error or incomplete.

## Gate

The gate pairs records by sample and repetition and resamples samples (at
least 8 pairs, otherwise `inconclusive`). It checks recall, kept-comment
retention and completeness with a 0.03 margin. Retention without labels is
`unsupported` and does not block; missing recall evidence, provider errors,
unpaired or mismatched records never pass. All samples come from this
repository, so a verdict holds for it, not for other codebases.

## Deterministic checks

`pnpm test` includes `test/eval/` (`pnpm test:eval` runs only that subset):
derivation, public-CLI provider tests with a synthetic adapter, scoring and
gate cases. They prove tooling behavior, not model quality.

Commit only redacted gate receipts to `eval/results/`, never source code,
quotes, machine paths or raw exports.
