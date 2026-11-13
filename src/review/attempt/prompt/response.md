# Worker response contract

Return one JSON object inside `<degreaser-result>` and `</degreaser-result>`.
Use the assigned aspect ID. The coordinator consumes the last such assistant block.
Do not include Markdown fences inside the block.

- `aspect`: the assigned aspect ID.
- `status`: `findings`, `no-findings`, `not-applicable` or `incomplete`.
- `findings`: an array. Nonempty for `findings`; empty for `no-findings` and
  `not-applicable`. An incomplete review may retain established findings.
- `limitations`: an array of explicit limitations. Required and nonempty for
  `incomplete`; include applicable constructs you could not examine and why.
- `reason`: required nonempty explanation for `not-applicable`.
- `unresolved`: optional array. Use it with `incomplete` to name what stays open
  besides unexamined paths, for example connected code or evidence you could not
  check. Each entry has `scope` (`paths`, `context` or `evidence`), a concrete
  nonempty `reason` and optionally the assessed `paths` it concerns. An
  `incomplete` result that lists every assigned path as examined must say what
  is unresolved here; do not claim a path as examined that you did not read.
- `examinedPaths`: every assessed path whose change you actually read and
  judged for this aspect, preferably as the repository-relative paths from the
  supplied change. Always include it, also for `not-applicable`. A path whose
  change you read and found to contain nothing this aspect covers is examined:
  list it. A path judged only from its name, the task or a summary, without
  reading its patch section, is not examined: do not list it. Unlisted readable
  paths count as unexamined: the coordinator reviews them in a focused
  follow-up pass and never certifies a clean or not-applicable result without
  them.

Each finding contains:

- `location`: repository-relative `path`, `side` (`old` for the base, `new` for
  the resolved review tree), positive `startLine` and `endLine` in that coordinate
  space. End must not precede start.
- `quote`: an exact excerpt of the cited source lines, not a paraphrase, with
  at least three non-whitespace characters. Copy source text without diff
  markers. Line endings and trailing spaces are ignored; if you copy patch lines
  with their `+`/`-`/space prefix on every line, the prefix is stripped for the
  side you cite. The path may be absolute or `./`-prefixed inside the repository
  and is normalized; paths outside it are invalid.
- `title`: the specific defect, not a generic slop label.
- `evidence`: its connection to the change (in an audit, the assessed code) and
  relevant source locations.
- `consequence`: observable harm or a justified maintenance cost.
- `countercheck`: the strongest reason to preserve the code, where you checked
  it and why it does not explain this change.
- `recommendation`: a concise direction, not a patch.
- `uncertainty`: any missing evidence affecting the finding.

Every finding field above is a string except `location`. `uncertainty` is an
optional string, not an array or null; omit it when there is no uncertainty.
`reason` is an optional nonempty string except that it is required for
`not-applicable`; omit it otherwise. Do not emit null for optional fields. As
a courtesy, the coordinator drops a `reason` that is null, empty or only
whitespace unless the status is `not-applicable`, where it stays invalid. It
never invents a reason, quote, location, status or coverage. No additional
fields are accepted and unknown fields are never discarded. If a result block is
rejected, the retry shows the validator's message; correct the block without
inventing evidence. The supplied JSON Schema is authoritative.

All prose is English. Evidence is source-only. No score, minimum finding count,
authorship claim or claim of executed tests is permitted. A malformed result
or missing evidence must never be represented as a clean review.
