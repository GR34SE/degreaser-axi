<p align="center">
  <img src="https://raw.githubusercontent.com/GR34SE/degreaser-axi/main/assets/branding/degreaser.png" alt="Degreaser — Removes slop!" width="760">
</p>

# Degreaser

Code review for coding agents. Degreaser checks for unnecessary complexity, broken contracts and misleading verification. It runs 17 focused reviewers in fresh, read-only sessions and returns findings with code quotes and suggested corrections. Your agent decides what to fix.

## Install

Requires Linux or macOS, Node 24+, Git, pnpm, and a logged-in Codex, Claude Code, Pi or Cursor. Linux needs a procps-compatible `/bin/ps` (minimal images such as Debian slim need the `procps` package). Claude Code, Pi and Cursor must be on PATH; the Codex worker is bundled.

The package is not published to npm yet. Build and link a checkout:

```sh
git clone https://github.com/GR34SE/degreaser-axi.git
cd degreaser-axi
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm link --global
```

Keep the linked checkout at a stable path.

## Use

In the Git repository you want to review:

```sh
degreaser-axi init
```

Choose the review model and the agent integrations you use, then start a new agent session (or reload Pi). Ask your agent:

> Run Degreaser on my current changes. The task was to add CSV import. Wait for the review, assess the findings, and fix the ones that apply.

Or use the CLI:

```sh
degreaser-axi review --scope worktree --task "Add CSV import"
degreaser-axi report
```

If the review returns `running`, follow its `degreaser-axi wait <run-id>` command. Keep the code unchanged until it finishes. A partial review is not a clean result.

Reviews read source; they do not run tests or apply fixes. Review context goes to your selected model provider, uses its quota, and is saved locally in ignored `.degreaser/` files. All 17 reviewers run by default; use `--aspects` to select fewer or `--concurrency` to limit simultaneous calls.

See `degreaser-axi --help` for commands and options, or `degreaser-axi doctor` for setup diagnostics. Details: [configuration and scopes](https://github.com/GR34SE/degreaser-axi/blob/main/assets/input-contract.md), [results and limitations](https://github.com/GR34SE/degreaser-axi/blob/main/assets/result-contract.md), [worker restrictions](https://github.com/GR34SE/degreaser-axi/blob/main/assets/native-profiles.md).

## Review aspects

All 17 built-in aspects are enabled by default. Each reviewer checks one question. Reports list aspects in this order: simplicity first, then from the most to the least damaging slop.

| Aspect | Review question |
| --- | --- |
| `unnecessary-complexity` | Is this the simplest implementation possible? |
| `masked-errors` | Does a fallback turn failure into apparent success? |
| `verification-theater` | Does a runtime or tooling check prove the property it claims to verify? |
| `contract-bypass` | Does a cast, suppression or default hide a real mismatch? |
| `incomplete-integration` | Is the new code connected to the real user path? |
| `low-value-tests` | Would this test detect broken behavior, or just confirm its own mock? |
| `scope-creep` | Did the change add features or refactoring outside the task? |
| `reinvented-infrastructure` | Does a handwritten cache, parser or similar mechanism miss required semantics? |
| `missed-reuse` | Does the repo or an existing dependency already solve this? |
| `wrong-abstraction` | Does a shared mechanism combine cases with conflicting rules? |
| `structural-erosion` | Does this change add responsibilities and branching to an overloaded unit? |
| `speculative-flexibility` | Do these options and extension points serve a current requirement? |
| `unnecessary-layers` | Does this wrapper, service or factory add useful behavior or a boundary? |
| `unjustified-defense` | Does this check protect a real boundary or possible state? |
| `convention-drift` | Does this introduce another way to do the same thing without a reason? |
| `unidiomatic-code` | Can a native construct remove unnecessary logic without changing behavior? |
| `low-value-comments` | Does the comment explain something the code cannot? |

A wrapper, comment or validation check is not automatically a problem. Reviewers must establish a concrete consequence and check reasons to keep the code. See the [catalog and aspect boundaries](https://github.com/GR34SE/degreaser-axi/blob/main/assets/catalog.md) for details.

For a one-run subset of enabled aspects:

```sh
degreaser-axi review --scope worktree --task "Add CSV import" --aspects missed-reuse,low-value-tests
```

## Configuration

`init` writes `.degreaserrc.json` at the Git root. Keep the exact `agent` and `model` you confirmed there; the Codex model below is an example, not a guarantee of availability.

```json
{
  "schemaVersion": 1,
  "agent": "codex",
  "model": "gpt-6-luna",
  "concurrency": 4,
  "maxRetries": 1,
  "limits": {
    "workerTimeoutSeconds": 300,
    "workerIdleSeconds": 120,
    "maxTurns": 40,
    "runTimeoutSeconds": 900
  },
  "aspects": {
    "low-value-comments": true,
    "scope-creep": false
  },
  "exclude": ["vendor", "src/generated"]
}
```

- `concurrency: 4` caps simultaneous reviewers; the default `null` leaves them uncapped.
- `aspects` accepts `true` (enabled), `false` (disabled), or `{ "model": "<exact-model-id>" }` to override the model for one aspect. Omitted aspects stay enabled. Changing its agent also requires an explicit compatible model.
- `maxRetries` counts extra attempts. The limits above are defaults; `maxTurns` is enforced natively only by Claude and is advisory for other workers.
- `exclude` adds literal repository-relative files or directory prefixes, not globs. It narrows assessed coverage, not worker read access.

`degreaser-axi config sync` fills missing settings with installed defaults without changing explicit choices. See the [configuration contract](https://github.com/GR34SE/degreaser-axi/blob/main/assets/input-contract.md) and [JSON schema](https://github.com/GR34SE/degreaser-axi/blob/main/assets/schemas/config-v1.json) for the full format and bounds.

## License

[MIT](LICENSE)
