# Finder response contract

Return one JSON object inside `<degreaser-result>` and `</degreaser-result>`.
The coordinator consumes the last such assistant block. Do not include Markdown
fences inside the block.

- `aspect`: the assigned aspect ID.
- `status`: `findings`, `no-findings`, `not-applicable` or `incomplete`.
- `findings`: an array of candidates. Nonempty for `findings`; empty for
  `no-findings` and `not-applicable`. An incomplete result may retain the
  candidates found so far.
- `kept`: optional array, only for rubrics with a `**Unit:**` line: every unit
  in the shard that you did not report, each with `location` and `quote`.
- `limitations`: an array of explicit limitations. Required and nonempty for
  `incomplete`.
- `reason`: required nonempty explanation for `not-applicable`; omit it
  otherwise.

Each candidate contains:

- `location`: repository-relative `path` of a shard path, `side` (`old` for the
  base, `new` for the resolved review tree), positive `startLine` and `endLine`
  in that coordinate space. End must not precede start.
- `quote`: an exact excerpt of the cited source lines, not a paraphrase, with
  at least three non-whitespace characters. Copy source text without diff
  markers or line-number prefixes. Line endings and trailing spaces are
  ignored; if you copy patch lines with their `+`/`-`/space prefix on every
  line, the prefix is stripped for the side you cite.
- `title`: one short line naming the specific suspected defect.

Do not emit null for optional fields. No additional fields are accepted. A
candidate whose quote does not match the cited lines is rejected. If a result
block is rejected, the retry shows the validator's message; correct the block
without inventing evidence. The supplied JSON Schema is authoritative.

All prose is English. Evidence is source-only. No score, authorship claim or
claim of executed tests is permitted.
