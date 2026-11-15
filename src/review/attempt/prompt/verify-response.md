# Verifier response contract

Return one JSON object inside `<degreaser-result>` and `</degreaser-result>`.
The coordinator consumes the last such assistant block. Do not include Markdown
fences inside the block.

- `aspect`: the assigned aspect ID.
- `status`: `verdicts` when every candidate has a verdict, otherwise
  `incomplete`.
- `verdicts`: one entry per candidate you judged.
- `limitations`: an array of explicit limitations. Required and nonempty for
  `incomplete`.

Each verdict contains:

- `candidate`: the candidate's number from the list.
- `verdict`: `upheld` or `refuted`.
- `reason`: one sentence explaining the verdict.
- `action`: required when `upheld`: what the caller should do, as a concise
  direction, not a patch. Omit it when `refuted`.
- `evidence`: optional decisive source quote, with `location` (repository-
  relative `path`, `side` `old` or `new`, positive `startLine` and `endLine`)
  and an exact `quote` of those lines without diff markers.

A verdict for an unknown candidate number, an upheld verdict without `action`
or a verdict whose evidence quote does not match the source is discarded, and
its candidate stays unverified. Do not emit null for optional fields. No
additional fields are accepted. The supplied JSON Schema is authoritative.

All prose is English. Evidence is source-only. No score, authorship claim or
claim of executed tests is permitted.
