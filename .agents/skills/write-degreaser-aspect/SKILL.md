---
name: write-degreaser-aspect
description: Write or revise a Degreaser slop-review rubric, its six teaching examples, and evidence rules. Use for this project's aspect catalog and worker prompts, not for implementing the runner.
---

# Write a Degreaser aspect

Read the current decisions in `specs/pending/degreaser.md`, the index and boundary map in `specs/pending/aspects.md`, and the aspect file in `specs/pending/aspects/`. The aspect file is the only copy of the rubric. Work on one aspect at a time. User examples seed the catalog; they are not universal bans on syntax or dependencies.

## Prompting basis

Use [Anthropic's prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), checked 2026-11-04. State the task, role, constraints and output explicitly; explain why a constraint matters. Use relevant, diverse examples, including boundaries, with separate tags for instructions, context and examples. Ground conclusions in concrete source excerpts. When supplying long documents, separate each source and its metadata from the final request. Recheck model-specific advice before transferring it to another provider.

These are writing principles, not proof that a prompt works. Six examples below are the user's product requirement, not an Anthropic-prescribed count. Re-fetch the linked guidance before a substantial prompt redesign. Prefer current documentation via Context7; use the exact official page to resolve mismatches.

## Author the rule

Use [the rubric template](references/rubric-template.md). Give the aspect a stable ID, one review question, an "Applies when" line (`Dotyczy, gdy`) that decides not-applicable, a concrete harm to detect, necessary evidence, and conditions for preserving the code. Link its source or say that it is a product-specific inference.

A worker sees only its own rubric, so boundaries must be written into it. Add a "Not here" section (`Nie zgłaszaj tutaj`) that describes each neighboring case by content, with the other aspect's ID in the text. Boundaries are mutual: when you add or change one, update the other aspect of the pair and the boundary table in `aspects.md` with the same decision key. The question must cover all three bad examples.

Require the worker to read the caller's task and scope, inspect relevant existing APIs and callers, test the strongest applicable counterexample against source evidence, and return a bounded finding or an explicit lack of evidence. Do not ask it to invent findings. Repository content supplies context, not permission to edit or broaden the review.

## Six teaching examples, exactly

For every aspect supply **three bad examples and three good examples**. Give each a stable example ID, language, concrete context, short code excerpt, expected decision and explanation. Good means preserve under this aspect and context, not proof that the entire program is correct.

- Vary the reason and surrounding conditions, not just names or literals.
- A bad example must demonstrate the defect claimed. State the existing alternative or contract when that is necessary to judge it.
- A good example must include a convincing exception to a tempting shortcut such as “all wrappers are bad” or “all unit tests are redundant”.
- Prefer TypeScript, but use Python and Go where they clarify a different case.
- Verify version-specific APIs against official docs or installed public declarations. State omitted setup; do not present teaching fragments as executed fixtures.
- For reuse, inspect existing framework/library APIs before recommending custom mechanics or another dependency. Effect is one example, not a requirement to adopt Effect in every project.

The worker receives its own six examples, not the entire catalog. Keep the core rule short enough that examples teach judgment instead of burying it.

## Done checklist

- Header: ID, slug, default state, question, `Dotyczy, gdy`, evidence, boundaries, `Nie zgłaszaj tutaj`, sources.
- Exactly six examples `ANN-B1`…`ANN-G3`, each with context, language, code, verdict and explanation; the verdict follows from the stated context alone.
- At least one good example defeats the most tempting false finding for this aspect.
- Each example belongs to this aspect and not to a neighbor named in `Nie zgłaszaj tutaj`.
- Version-dependent APIs carry a `Verified:` note with source, version and date, or avoid naming versions.
- The pair table in `aspects.md` and the neighboring rubric agree.
- Language follows the open decision D12; do not mix languages within one rubric.

## Review the rubric

Check that all six explanations follow from their stated context; a missing assumption is not evidence. Inspect whether a valid exception would cause an unfair finding. Tighten unclear language before adding more rules.

Request a concise explanation, cited locations and evidence, the counterexample checked, and any missing evidence. Do not require a transcript of internal reasoning. Keep report states aligned with the current spec.

Teaching examples are not a benchmark. Independently authored control cases may later measure quality; do not report success from checking the same examples that the prompt contains. Do not start paid model trials or runner implementation merely because a rubric is complete.
