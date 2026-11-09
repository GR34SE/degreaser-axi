# Evaluation and improvement

Development-only, source-backed evaluation through promptfoo 0.125.1 and GEPA
0.1.4. Claude Haiku remains the owner's fixed worker recommendation. No manual
grading, model judge, production dependency, or model inference in CI.

## Prepare source data

Keep the downloaded corpus outside Git. `pnpm eval:derive -- --source-root
<collection> --output eval/.generated/datasets` reads it without installing or
executing third-party code. The output contains disposable Git repositories,
a JSONL sample manifest and derivation receipts. Do not commit that output.
`--source` (repeatable) selects sources, `--self-repo` names a checkout that
contains the pinned self revisions, and `--contrasts` opts into the self
instruction/scope variants described in [datasets](datasets/README.md).

Sources:

| Source                                              | Pinned input                                      | Meaning                                                   |
| --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Degreaser self-cleanup                              | `b4a1ede` → `d232af8`                             | owner removal of comment blocks                           |
| [SWE-Refactor](https://zenodo.org/records/17196850) | `pure_refactoring_data.json` from record 17196850 | accepted refactoring regions, mapped by operation type    |
| [SimpliBench](https://zenodo.org/records/12176049)  | paired tagged/untagged `small/test.jsonl`         | source simplification regions; tags removed before review |
| Cleanup PR corpus                                   | pinned raw PR metadata and base/head snapshots    | accepted change regions; closed/unmerged PRs excluded     |

These are **change proxies**, not comprehensive slop annotations. An accepted
refactoring is not necessarily required. Untouched code is not a known negative.
Unmatched findings contribute only to `precisionProxy`, never a claim of
semantic precision. Unsupported aspects have no recall measurement. Larger
datasets do not remove systematic label bias.

## Run a baseline

Build the product, then plan a bounded selection:

```sh
pnpm build
pnpm eval -- --samples eval/.generated/datasets/samples.jsonl \
  --family self --limit 30 --model <exact-haiku-id> --repeat 3 \
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
`promptfooconfig.json`, `records.jsonl` and `summary.json`. Promptfoo owns repeat
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
A well-formed `partial` review of a candidate scores 0 for that sample, keeps
`complete: false` and its reason in the feedback, and the campaign continues to
save its best candidate. Provider, authentication or quota errors, malformed or
mismatched exports, a missing REPORT denominator, and any run failure not
explained by partial records still stop the campaign.

Run the candidate and baseline on the identical frozen regression manifest,
then compare their records:

```sh
pnpm eval:gate -- --baseline <baseline>/records.jsonl \
  --candidate <candidate>/records.jsonl --output <receipt.json>
```

The gate checks paired data, per-family recall uncertainty, proxy precision,
explicit PRESERVE/forbidden sentinels, completeness and resource margins.
A well-formed `partial` review pairs as completeness 0; its anchor metrics are
missing, so they stay inconclusive rather than pass. A completed review with
rejected quotes whose coverage a later pass recovered is complete.
Insufficient evidence is not a pass. A non-regression pass alone does not prove
improvement. Only a separate ordinary code review can merge a rubric change;
no human labels or per-finding decisions are required.

The imported corpus currently lacks explicit source-backed PRESERVE labels,
and self has only one independent source cluster. The strict gate therefore
returns **inconclusive**, not a release clearance. Source-backed negative cases
and independent comment sources are still needed; unchanged code is not a
substitute. No baseline or model-quality improvement is claimed in this change.

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
