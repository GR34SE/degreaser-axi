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
    "preserve": [],
    "forbidden": []
  },
  "provenance": { "source": "self", "revision": "full-sha" }
}
```

`repo.directory` is a local generated artifact, never a committed machine path.
`review.base` is required for branch scope. The provider copies the materialized
Git repo into its own temporary directory before every run, never edits source
datasets, never includes labels in the worker repo. Each label has a stable ID,
source-side line range, optional accepted `aspects` and `alsoAccept` arrays.
`forbidden` entries are `{id, pattern, path?}` literal case-insensitive direction
matches, only an explicit lexical sentinel, not a semantic harm judge.

Dataset derivatives must identify weak labels honestly: accepted refactorings
are change proxies, not verified slop labels. Untouched source is not guaranteed
clean and must not be converted to hard negatives. Only explicit source-backed
negative cases enter `preserve`. Unmatched findings remain proxy measurements.
Splits group all records from the same repository/commit/template family.

## Provider

`eval/provider.mjs` exports the promptfoo default provider class. Constructor
`{id?, config: {productDir, agent, model, timeoutMs?, env?,
budgetFile?, sessionBudget?}}`. Exact Haiku ID
comes from the product recommendation, not a different model selection.
`callApi(prompt, {vars:{sample}})` returns `{output: JSON.stringify(envelope)}`.
Failures return `{error}` or throw, never clean output.

Envelope:
`{sampleId, export: <public export JSON>, meta: {productSha, productHash, agent, model,
sampleHash, sessionCount, durationMs, ...}}`.
Use terminal public CLI output, no inference from exit zero alone.
`productHash` covers the built resources and pinned dependency inputs, including
dirty candidate text that Git HEAD alone cannot identify.

## Scoring

`eval/assert/anchor-match.mjs` exports `scoreSample(sample, envelope)` and default
promptfoo assertion `(output, context)`, reading `context.vars.sample`.
`eval/assert/harm.mjs` exports its default promptfoo assertion.
`scoreSample` returns at least `{recall, precisionProxy, preserveRate,
forbiddenCount, complete, hits, misses, unmatchedFindingIds}`.
Match only cited locations in the correct file and aspect; include valid
`path:line[-line]` references in finding `evidence`, deduplicate repeated hits.
Invalid/partial exports fail closed. Undefined metric denominators are null,
never fabricated perfect scores. `preserveRate` is retention: 1 means no
PRESERVE anchors were hit, 0 means all were hit.

`eval/gate.mjs` consumes paired JSON run records with
`{sample, envelope, repeat}`. Pair exact sample/input, repetition, agent/model;
require same evaluated sample manifest and report per-family metrics, excluded
or missing rows and paired recall deltas. It must not pass absent/incomplete
data, compare an absolute confidence bound to a point baseline, or treat repeats
as independent source samples.
