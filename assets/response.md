# Worker response contract

Return one JSON object inside `<degreaser-result>` and `</degreaser-result>`.
Use the assigned aspect ID. The coordinator consumes the last such assistant block.
Do not include Markdown fences inside the block.

- `aspect`: the assigned A01-A16 ID.
- `status`: `findings`, `no-findings`, `not-applicable` or `incomplete`.
- `findings`: an array. Nonempty for `findings`; empty for `no-findings` and
  `not-applicable`. An incomplete review may retain established findings.
- `limitations`: an array of explicit limitations. Required and nonempty for
  `incomplete`; include applicable constructs you could not examine and why.
- `reason`: required nonempty explanation for `not-applicable`.

Each finding contains:

- `location`: repository-relative `path`, `side` (`old` for the base, `new` for
  the resolved review tree), positive `startLine` and `endLine` in that coordinate
  space. End must not precede start.
- `quote`: an exact excerpt of the cited source lines, not a paraphrase.
- `title`: the specific defect, not a generic slop label.
- `evidence`: its connection to the change and relevant source locations.
- `consequence`: observable harm or a justified maintenance cost.
- `countercheck`: the strongest reason to preserve the code, where you checked
  it and why it does not explain this change.
- `recommendation`: a concise direction, not a patch.
- `uncertainty`: any missing evidence affecting the finding.

Every finding field above is a string except `location`. `uncertainty` is an
optional string, not an array or null; omit it when there is no uncertainty.
`reason` is an optional nonempty string except that it is required for
`not-applicable`; omit it otherwise. Do not emit null for optional fields.
No additional fields are accepted. The supplied JSON Schema is authoritative.

All prose is English. Evidence is source-only. No score, minimum finding count,
authorship claim or claim of executed tests is permitted. A malformed result
or missing evidence must never be represented as a clean review.
