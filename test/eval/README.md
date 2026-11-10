# Evaluation

Development-only measurement of how well review workers find slop, with this
repository's own history as ground truth. It judges a prompt or rubric change;
it is not part of the package. Nothing here runs a model in CI: `pnpm test`
covers the tooling with a synthetic adapter, which proves orchestration, not
model quality.

## Improvement loop

```sh
pnpm build
pnpm eval derive --output .degreaser/eval/dataset                        # 1. labels
pnpm eval run --samples .degreaser/eval/dataset/samples.jsonl --split all \
  --repeat 1 --output .degreaser/eval/baseline --allow-models             # 2. baseline
# 3. read .degreaser/eval/baseline/summary.md and pick ONE surface
# 4. change it in a separate checkout and run pnpm build there
pnpm eval run --samples .degreaser/eval/dataset/samples.jsonl --split all \
  --repeat 1 --product <candidate-checkout> \
  --output .degreaser/eval/candidate --allow-models                       # 5. candidate
pnpm eval gate --baseline .degreaser/eval/baseline/records.jsonl \
  --candidate .degreaser/eval/candidate/records.jsonl --mode improvement  # 6. verdict
```

Steps 2 and 5 spend worker sessions (`claude` with `--model`, default
`claude-haiku-4-5-20251001`). Check login and quota first; there is no API,
account or model fallback. Without `--allow-models`, `run` prints the plan and
launches nothing. `--split all` is 72 reviews, at most 144 sessions with the
single retry; `--budget` (default 600) rejects a larger worst case before
anything starts. It does not bound tokens or time. `--concurrency` runs that
many reviews at once.

Step 4 may iterate on `--split dev` only; step 6 also compares the
`regression` split that step 4 must not consult. Generated output stays in the
ignored `.degreaser/`; do not commit it.

## Labels

`derive` compares `b4a1ede` with the owner's cleanup `d232af8` (it needs the
full history of `main`) over the TypeScript files present in both:

- **REPORT**: a comment block (consecutive line comments or one block comment)
  the owner deleted entirely.
- **PRESERVE**: a comment block outside every changed range and unchanged after
  the cleanup.
- Anything else, including partly edited comments, is unlabelled.
  `test/live/support/comment-fixtures.ts` is excluded.

Files are grouped by their first three path segments into samples, assigned by
a fixed hash to `dev` (about 70%) or `regression`. `self/whole-repository`
(`regression`) audits the whole repository against the union of all labels.
The output holds `samples.jsonl` and `repo/`, the before revision as a
single-commit repository without the owner's history.

## Runs

Each review copies `repo/` to a temporary directory, writes its
`.degreaserrc.json`, and runs the built CLI's `review` and `wait` until the
run ends. Labels never enter the copy. The record is scored only when the run
completed with the requested worker. A `partial` run counts as incomplete,
never clean, when every unresolved aspect's last attempt ended with invalid
output, the output limit, or a usable result; any other cause (authentication,
quota, model, network, cancellation, cleanup) is an error, not evidence about
quality. An interrupt cancels owned runs and still writes the summary of what
was measured. The command exits 1 when any record is an error or incomplete.

A finding location hits a label when the path matches, the side is `new`, the
line ranges intersect and the location spans at most 30 lines. Locations are
the finding's range, `path:line[-line]` references in its evidence, and line
lists there (`lines 15, 82–85 and 201`) for its own file.

`summary.md` shows, per group (`dev`, `regression`, whole repository):

| Column           | Meaning                                                |
| ---------------- | ------------------------------------------------------ |
| Recall           | REPORT labels hit, counting evidence locations         |
| Recall (primary) | the same with only the finding's own range             |
| Retention        | PRESERVE labels left alone (1 means none were flagged) |
| Complete         | share of measured reviews that completed               |

It lists labels missed in every repetition, hit rates by review size, file
length, position and label length, and a diagnosis heuristic:

| Signal                                         | Look at                                |
| ---------------------------------------------- | -------------------------------------- |
| recall well above recall (primary)             | nothing: the worker groups findings    |
| hit rate falls with more files or longer files | coverage or budget, not rubric wording |
| low recall without those drops                 | the aspect rubric                      |
| kept comments flagged                          | the rubric over-reports                |

## Gate

`gate` pairs records by sample and repetition, averages repetitions per
sample, and bootstraps paired samples (at least 8, otherwise `inconclusive`)
for recall, retention and completeness, each with a 0.03 non-regression
margin. Retention without labels is `unsupported` and does not block. An
incomplete review leaves recall and retention inconclusive. `--mode
improvement` also requires the recall interval to lie above zero. Errors,
duplicates, unpaired records and records whose input or model differ never
pass. Exit 0 means pass.

## Limits

All samples come from one repository and one cleanup, so a verdict holds for
this codebase only. Only `low-value-comments` is labelled, and there are just
13 PRESERVE labels, so retention is a weak signal. Unlabelled code is unknown,
not clean.
