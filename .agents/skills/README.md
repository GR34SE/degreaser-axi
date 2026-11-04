# Repository skills

These seven skills are instructions for developing Degreaser. They are not the skill installed in customer projects. Read the relevant skill before its workflow; AGENTS.md defines the current scope.

| Skill | Use |
| --- | --- |
| [write-degreaser-aspect](write-degreaser-aspect/SKILL.md) | Rubrics, boundaries, evidence and six examples; authored for this repository. |
| [axi](axi/SKILL.md) | Official AXI interface conventions. |
| [lavish](lavish/SKILL.md) | Visual review when requested; the previous workshop is closed. |
| [deslop-scoped](deslop-scoped/SKILL.md) | Clean the authorized implementation diff within the caller-selected scope. |
| [thermo-nuclear-code-quality-review](thermo-nuclear-code-quality-review/SKILL.md) | Required structural quality review during development, applied to the caller-selected scope. |
| [test-audit](test-audit/SKILL.md) | Required when adding or reviewing tests. |
| [no-mistakes](no-mistakes/SKILL.md) | Required development validation pipeline; not initialized or run during preparation. |

The future product skill is an [authoring template](../../specs/pending/templates/degreaser/SKILL.md), outside the active skills directory until the CLI exists.

## Discovery

`.agents/skills/` is read natively by Codex and Pi. Claude Code reads only `.claude/skills/`, so that directory contains one symlink per skill pointing here; Claude Code supports symlinked skill directories. Claude Code prefers a personal skill over a project skill with the same name. The adapted cleanup skill is therefore named `deslop-scoped`, so a global `deslop` (which diffs against main) cannot shadow it. The other skills are identical to the user's global copies, so shadowing them changes nothing. Droid discovery (`.factory/skills`) is not set up; read skills by path there.

## Provenance and licenses

Each copied skill has a `SOURCE.md` (source, fetch date, modifications, checksum) and, where the source is licensed, its `LICENSE`:

- `axi`: kunchenguid/axi, MIT, unmodified.
- `deslop-scoped`: cursor/plugins `cursor-team-kit/skills/deslop`, MIT (Cursor), modified.
- `thermo-nuclear-code-quality-review`: cursor/plugins, MIT (Cursor), unmodified.
- `lavish`: kunchenguid/lavish-axi, MIT (Kun Chen), unmodified.
- `no-mistakes`: kunchenguid/no-mistakes, MIT (Kun Chen), version matching CLI v1.84.0.
- `test-audit`: the user's local skill, inspired by openclaw's test-audit but not a copy of its text.
- `write-degreaser-aspect` and the product template: authored for this project.

Native metadata such as `disable-model-invocation` (thermo review) and `user-invocable` (no-mistakes) is preserved from the source. With `disable-model-invocation`, Claude Code does not load the skill automatically, so AGENTS.md routes the mandatory reviews by path.
