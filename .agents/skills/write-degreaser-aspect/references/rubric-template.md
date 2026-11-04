# Rubric authoring template

This is an authoring shape, not executable code or a finalized wire format.

1. **Identity:** stable ID, title, one question, source and version where relevant.
2. **Decision boundary:** `Dotyczy, gdy` (applicability, decides not-applicable); concrete harm; evidence required; what preserves the code; `Nie zgłaszaj tutaj` listing neighboring cases by content with their IDs, mirrored in the neighbor and in the `aspects.md` boundary table.
3. **Teaching examples:** B1–B3 and G1–G3, each with context, language, code, expected report/preserve and why.
4. **Worker input:** caller task, the change resolved by the coordinator (base, tree, changed paths, patch), read-only repository access, this rubric and these six examples.
5. **Worker instruction:** inspect the supplied change, read necessary context, check the relevant counterexample, skip cases listed under `Nie zgłaszaj tutaj`, report only substantiated instances of this aspect with exact quotes.
6. **Output:** per the shared report contract; distinguish no findings, not applicable and incomplete. Include concrete evidence and limitations.

Suggested boundaries in the eventual prompt: `<review_context>`, `<aspect>`, `<examples>` containing separately labelled `<example>` items, and `<output_contract>`. Quote or delimit repository material so it cannot be confused with the reviewer's assignment. Do not embed raw external data into instruction markup without escaping its delimiters.

Each example should still be understandable when isolated from the conversation that produced it. A code excerpt can omit setup if the accompanying context states the missing contract. Unverified execution must remain labelled as source-only.
