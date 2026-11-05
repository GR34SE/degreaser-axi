# Repository skills

External skills are installed with the [Skills CLI](https://skills.sh/docs/cli), not maintained as hand-copied forks. `skills-lock.json` records their sources and content hashes. Do not edit installed upstream files; keep repository-specific guidance in AGENTS.md or a small local skill.

| Skill | Origin and use |
| --- | --- |
| [axi](axi/SKILL.md) | `kunchenguid/axi`: AXI interface conventions. |
| [lavish](lavish/SKILL.md) | `kunchenguid/lavish-axi`: authorized visual workshops; the previous workshop is closed. |
| [deslop](deslop/SKILL.md) | `cursor/plugins`: upstream cleanup guidance, invoked through deslop-scoped here. |
| [thermo-nuclear-code-quality-review](thermo-nuclear-code-quality-review/SKILL.md) | `cursor/plugins`: required structural review during development. |
| [no-mistakes](no-mistakes/SKILL.md) | `kunchenguid/no-mistakes`: required development validation pipeline. |
| [deslop-scoped](deslop-scoped/SKILL.md) | Local scope instruction that reads installed deslop by path. |
| [test-audit](test-audit/SKILL.md) | Existing custom local test-review instructions; not replaced with a different upstream skill. |
| [write-degreaser-aspect](write-degreaser-aspect/SKILL.md) | Project-authored rubrics, boundaries, evidence and six teaching examples. |

The generated [product skill](../../assets/skills/degreaser/SKILL.md) stays outside active development skill directories. It ships as a package asset; development never installs it into the actual user's projects or global harness directories.

## Install and update

Run from the repository root. These commands install only project skills, with canonical files under `.agents/skills/` and Claude Code symlinks under `.claude/skills/`:

```sh
npx skills add kunchenguid/axi --skill axi --agent codex claude-code pi -y
npx skills add kunchenguid/lavish-axi --skill lavish --agent codex claude-code pi -y
npx skills add cursor/plugins --skill deslop thermo-nuclear-code-quality-review --agent codex claude-code pi -y
npx skills add kunchenguid/no-mistakes --skill no-mistakes --agent codex claude-code pi -y
```

To restore locked installations, use `npx skills experimental_install --frozen-lockfile`; to update deliberately, use `npx skills update --project` and review the resulting changes. Installing a skill does not update its CLI or authorize executing its workflow. Check the installed CLI's current help and local `no-mistakes axi` state before starting or resuming delivery.

## Discovery

Codex and Pi use `.agents/skills/`; Claude Code uses `.claude/skills/` symlinks to the same directories, including the three local skills. Read required skills by their project paths to avoid personal copies taking precedence. In particular, thermo-nuclear disables automatic model invocation, and deslop-scoped selects the installed deslop explicitly. Droid discovery is not configured in this developer checkout; read the files by path when using it.

Project-facing text, skills and worker rubrics are English. Local, gitignored specifications and workshop history may remain Polish (D12). Keep upstream metadata and any files supplied by the installer unchanged. No additional hand-maintained SOURCE.md or LICENSE sidecars are needed for the local skills.
