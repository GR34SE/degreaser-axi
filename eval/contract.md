# Internal evaluation boundary

All eval code is development-only. No imports from `src/`, no manual grading,
no model calls in deterministic tests. Haiku stays the recommended model.

## Samples

`samples.jsonl` contains one object per review:

```json
{
  "id": "self/comments/module",
  "family": "self",
  "split": "dev",
  "cluster": "repository:degreaser-axi",
  "labelKind": "owner-diff",
  "aspects": ["low-value-comments"],
  "repo": { "directory": "/absolute/materialized/repo" },
  "review": {
    "scope": "repository",
    "paths": ["src/module"],
    "task": "Audit the selected source."
  },
  "target": {
    "report": [
      {
        "id": "r1",
        "path": "src/module/a.ts",
        "lines": [2, 4],
        "aspects": ["low-value-comments"]
      }
    ],
    "preserve": []
  },
  "provenance": { "source": "self", "revision": "full-sha" }
}
```

`repo.directory` is a local generated artifact, never a committed machine path.
`review.base` is required for branch scope. The provider copies the materialized
Git repo into its own temporary directory before every run, never edits source
datasets, never includes labels in the worker repo. Each label has a stable ID,
source-side line range and an optional accepted `aspects` array.

Untouched source is not guaranteed clean and must not be converted to hard
negatives. Only explicit source-backed negative cases enter `preserve`:
comments the owner kept unchanged through the cleanup. The `self-whole` family
holds one whole-repository review (`review.paths: []`) over the same labels.
`regression` samples are never used to choose a candidate.

## Provider

`eval/provider.mjs` exports `reviewSample(sample, {productDir, agent, model,
timeoutMs?, env?, signal?})`. It returns the envelope
`{sampleId, export: <public export JSON>, meta: {productSha, agent, model,
sampleHash, sessionCount, durationMs, outcome?}}` or throws; a failure is never
clean output. It uses the terminal public CLI result, not exit zero alone, and
checks the worker agent/model against the requested pair.

## Scoring

`eval/assert/anchor-match.mjs` exports `scoreSample(sample, envelope)`, which
returns `{complete, reason, recall, recallPrimary, preserveRate, hits, misses,
preserveHits}`.
A location hits a label when file, side and aspect match, the line ranges
intersect and the location spans at most 30 lines. Locations are the finding's
primary range, `path:line[-line]` references in `evidence`, and prose line
lists there (`lines 15, 82–85 and 201`) for the finding's own file. `recall`
uses all of them; `recallPrimary` uses the primary range only.
Invalid exports fail closed. A completed export is complete under the
product's contract even when rejected quotes were later recovered; a well-formed
`partial` export is incomplete (`reason: "incomplete-review"`), never clean,
only with the provider's `meta.outcome: "worker-quality-partial"`; without it
the reason is `unattributed-partial` and the record is invalid evidence.
Undefined metric denominators are null, never fabricated perfect scores.
`preserveRate` is retention: 1 means no PRESERVE anchors were hit, 0 means all
were hit.

## Gate

`eval/gate.mjs` consumes two `records.jsonl` files of
`{sample, repeat, envelope?, error?}`. It pairs exact sample input, repetition
and agent/model, averages repetitions per sample and bootstraps paired samples
(minimum 8) for recall, `preserveRate` and completeness. Worker-quality partial
reviews count as completeness 0 and leave anchor metrics inconclusive. It must
not pass absent, erroneous or incomplete data, compare an absolute confidence
bound to a point baseline, or treat repeats as independent samples.
