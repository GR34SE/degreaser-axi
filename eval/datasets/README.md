# Self dataset derivation

Development-only and deterministic: no model, no downloaded data, no executed
source code.

```sh
pnpm eval:derive -- --output eval/.generated/datasets
```

The output directory must be new and its parent must exist. It receives
`samples.jsonl` and one materialized Git repository per sample repository under
`repos/`. Snapshot commits use fixed dates and the configured Git identity. The
pinned revisions must be present in this checkout.

## Labels

The pinned before revision `b4a1ede` is compared with the owner cleanup
accepted on main, `d232af8`, over `.ts`-family files present in both:

- **REPORT:** a lexical comment block (consecutive line comments or one block
  comment) that the owner deleted entirely.
- **PRESERVE:** a comment block outside every old-side diff range and unchanged
  after the cleanup (`<path>:keep:<start>-<end>`, before-side lines). The
  cleanup was exhaustive, so these are source-backed negatives; every other
  surviving comment remains unknown.
- `test/live/support/comment-fixtures.ts` holds deliberate low-value fixtures
  and yields neither.

Samples are directory groups (`self/comments/<group>/...`) assigned by a fixed
hash to `dev` (about 70%) or `regression`. `self-whole/comments/whole-repository`
(split `regression`, `paths: []`) carries the union of all anchors and measures
the whole-repository audit. Every sample is in the one cluster
`repository:degreaser-axi`.
