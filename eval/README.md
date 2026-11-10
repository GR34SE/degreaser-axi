# Evaluation and improvement

Development-only, source-backed evaluation through promptfoo 0.125.1 and GEPA
0.1.4. Claude Haiku remains the owner's fixed worker recommendation. No manual
grading, model judge, production dependency, or model inference in CI.

## The improvement loop

One pass through the loop, with `self` as the measured source:

```sh
pnpm build
pnpm eval:derive -- --output eval/.generated/datasets                    # 1. labels
pnpm eval -- --samples eval/.generated/datasets/samples.jsonl --split all \
  --model <exact-haiku-id> --repeat 1 --output eval/.generated/baseline \
  --allow-models                                                         # 2. baseline
# 3. read eval/.generated/baseline/summary.md and pick ONE surface
pnpm eval:campaign -- --config <campaign.json> --allow-models            # 4. candidate text
# 5. apply candidate.md to the surface in a branch, pnpm build, then:
pnpm eval -- --samples eval/.generated/baseline/samples.jsonl --split all \
  --model <exact-haiku-id> --repeat 1 --output eval/.generated/candidate \
  --allow-models
pnpm eval:gate -- --baseline eval/.generated/baseline/records.jsonl \
  --candidate eval/.generated/candidate/records.jsonl --mode improvement \
  --output eval/results/<date>-<surface>.json                            # 6. verdict
```

Steps 2, 4 and 5 spend Haiku sessions; without `--allow-models` step 2 prints
the plan only. `--split all` on the default dataset is 72 reviews (at most 144
sessions with the fixed retry).

Step 3 decides what to change. `summary.md` reports recall with and without
evidence locations, how often kept comments were flagged, and the hit rate by
review size, file length, position and label length. Its diagnosis section
names the likely surface:

| Signal                                             | Change                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| recall far above `recallPrimary`                   | nothing: the worker groups findings            |
| hit rate falls with paths, file length, whole repo | coverage or budget in the product, not wording |
| low recall without those drops                     | the aspect rubric (campaign surface)           |
| kept comments flagged                              | the rubric over-reports (campaign surface)     |

The diagnosis is a heuristic for where to look, not proof of cause.

Step 4 trains only on `dev` samples; a candidate's score is recall multiplied
by the share of kept comments it left alone, so reporting everything does not
win. Step 6 compares the same frozen samples, including the `regression`
split the campaign never saw. `passed` with `--mode improvement` means the
candidate is measurably better and no metric regressed beyond its margin. A
rubric change still merges through ordinary code review. Commit the redacted
receipt. Corrected misses become permanent regression evidence by staying in
the dataset; a new owner cleanup commit for another aspect extends the labels
by adding its pinned revisions to `eval/datasets/self.mjs`.

## Prepare source data

`pnpm eval:derive -- --output eval/.generated/datasets` derives the default
`self` source from this checkout's pinned Git history. It needs no downloaded
data, runs no third-party code and writes disposable Git repositories, a JSONL
sample manifest and a receipt. Do not commit that output. `--self-repo` names
another checkout that contains the pinned revisions, and `--contrasts` opts
into the instruction/scope variants described in [datasets](datasets/README.md).

| Source                                              | Default | Labels                                                                |
| --------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| Degreaser self-cleanup `b4a1ede` → `d232af8`        | yes     | REPORT: comments the owner removed. PRESERVE: comments the owner kept |
| [SWE-Refactor](https://zenodo.org/records/17196850) | no      | refactored method as a change proxy; Move refactorings excluded       |
| [SimpliBench](https://zenodo.org/records/12176049)  | no      | one-line files, so any finding counts: a smoke signal, not recall     |
| Cleanup PR corpus                                   | no      | accepted change regions of merged PRs                                 |

The opt-in sources need `--source <name> --source-root <collection>`. They are
**change proxies**: an accepted refactoring is not necessarily required and
untouched code is not a known negative. Only `self` carries PRESERVE labels.
Only `low-value-comments` has recall evidence today; other aspects gain it
when an owner cleanup commit for them is pinned.

## Run a baseline

Build the product, then plan a bounded selection:

```sh
pnpm build
pnpm eval -- --samples eval/.generated/datasets/samples.jsonl \
  --family self --split dev --limit 30 --model <exact-haiku-id> --repeat 3 \
  --output eval/.generated/baseline
```

No inference happens until `--allow-models` is added. Confirm the exact Haiku
ID and native login/quota first. There is no paid API, account or model fallback.
`--budget` reserves worst-case worker sessions, including the fixed retry.
The persistent admission receipt also applies to native resume/retry commands.
It does not bound tokens or wall-clock cost. `--limit` selects samples; freeze the same manifest for
baseline and candidate. Run one family at a time to preserve visibility.

Each review uses an isolated copy of the sample, waits for the terminal public
CLI result and scores both primary and evidence locations. Gold labels remain
outside the worker repository. Raw exports and traces stay local. Telemetry
and provider-response caching are disabled.

The run directory contains the frozen selected `samples.jsonl`, native
`promptfooconfig.json`, `records.jsonl`, `summary.json` and `summary.md`. Promptfoo owns repeat
execution and recovery. For a failed
native evaluation use its saved config and local state:

```sh
PROMPTFOO_DISABLE_TELEMETRY=1 \
PROMPTFOO_CONFIG_DIR="$PWD/eval/.generated/promptfoo" \
pnpm exec promptfoo eval -c <run-directory>/promptfooconfig.json \
  --resume <eval-id> --no-cache --no-share
```

`--retry-errors` is an explicit retry of provider errors, not a clean result.
It cannot exceed the saved admission budget. Reservations remain spent even
if an attempt fails before inference. Do not run two recovery commands at once.
A leftover `admissions.json.lock` fails closed: verify all owned processes have
stopped before removing only that lock. Do not reset the admission receipt.
Recovery updates `records.jsonl`; the original `summary.json` is not regenerated.
Do not edit materialized input or labels between baseline and candidate.

## Improve one surface

`eval/gepa/campaign.example.json` defines the product revision, one rubric or
`worker.md`, the manifest, model and metric-call budget. Copy it to a local file
and supply the exact Haiku ID and absolute paths. Only `dev` samples with
REPORT anchors may train the optimizer.
`maxMetricCalls` caps evaluated samples; `maxSessions` caps worst-case review
sessions plus native reflection calls. A campaign stops before an unaffordable
iteration and saves its best candidate, which may still be the seed.
Use the baseline's selected manifest, not the entire imported corpus: the
initial validation alone must fit the campaign budget.

```sh
uv sync --locked --project eval/gepa --python 3.14
pnpm eval:campaign -- --config <campaign.json>
pnpm eval:campaign -- --config <campaign.json> --allow-models
```

GEPA evaluates candidate text in temporary detached worktrees, builds that
product and calls the same promptfoo provider. Its native reflection call has
no tools, hooks, skills or MCP access. No API fallback is configured. A campaign
produces a candidate, not a product edit or an effectiveness claim.
The provider attributes a `partial` review to worker quality only when every
unresolved aspect's last attempt ended in invalid output, the output limit, or
a valid incomplete result, including one stopped by a lifecycle timeout or
deadline. A timeout without validated evidence or with a network-level code
(`ETIMEDOUT`, `TIMEOUT` and peers) is ambiguous and fails closed. Authentication, quota,
account, model, environment, network, cleanup or unknown causes become provider
errors that name the cause and recovery; they are not candidate evidence.
Such an attributed `partial` review of a candidate scores 0 for that sample,
keeps `complete: false` and its reason in the feedback, and the campaign continues to
save its best candidate. Provider, authentication or quota errors, malformed or
mismatched exports, a missing REPORT denominator, and any run failure not
explained by partial records still stop the campaign.

Run the candidate and baseline on the identical frozen regression manifest,
then compare their records:

```sh
pnpm eval:gate -- --baseline <baseline>/records.jsonl \
  --candidate <candidate>/records.jsonl --output <receipt.json>
```

The gate checks paired data, recall uncertainty, proxy precision, PRESERVE and
forbidden sentinels, completeness and resource margins per family. Evidence
from one source repository is resampled over its samples (at least 8) and the
receipt is marked `single-source`: the verdict holds for that repository, not
for other codebases. A metric with no labels on either side is reported as
unsupported and does not block; a family without recall evidence never passes.
A worker-quality `partial` review pairs as completeness 0 and its missing
anchor metrics stay inconclusive; an unattributed `partial` record is invalid
evidence. A completed review with rejected quotes whose coverage a later pass
recovered is complete. No baseline or model-quality result is claimed in this
change.

## Deterministic regression checks

`pnpm test` includes `test/eval/`: dataset derivation, public-CLI provider tests
with synthetic ACP, scorer replay, gate failure cases and optimizer boundaries.
`pnpm test:eval` runs that subset. These tests prove tooling behavior, not model
quality. Model-quality measurements remain opt-in and local.
The pinned optimizer itself has an additional offline check:
`uv run --locked --project eval/gepa --python 3.14 python test/eval/gepa-optimizer.py`.

Commit only redacted gate receipts to `eval/results/`, never source code,
quotes, machine paths, raw exports or optimizer traces. Split source families
together; a new commit or template from a training family is not a holdout.
