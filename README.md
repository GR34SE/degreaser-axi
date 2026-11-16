<p align="center">
  <img src="https://raw.githubusercontent.com/GR34SE/degreaser-axi/main/docs/images/degreaser.png" alt="Degreaser — Removes slop!" width="760">
</p>

# Degreaser

Code review for coding agents. Degreaser checks for unnecessary complexity, broken contracts and misleading verification. It runs 18 focused reviewers in fresh, read-only sessions and returns findings with code quotes and suggested corrections. A second, independent pass tries to refute each finding before it is reported. Your agent decides what to fix.

## Install

Requires Linux or macOS, Node 24+, Git, pnpm, and a logged-in Codex, Claude Code, Pi or Cursor. Linux needs a procps-compatible `/bin/ps` (minimal images such as Debian slim need the `procps` package). Claude Code, Pi and Cursor must be on PATH; the Codex worker is bundled.

The package is not published to npm yet. Build a checkout, then install its packed archive globally:

```sh
git clone https://github.com/GR34SE/degreaser-axi.git
cd degreaser-axi
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm pack --pack-destination /tmp
pnpm add --global /tmp/degreaser-axi-1.0.0.tgz
```

The archive installation is independent of later checkout builds. `degreaser-axi version` shows its build commit.

## Use

In the Git repository you want to review:

```sh
degreaser-axi init
```

Choose two models, one to find candidates and one to verify them, and the agent integrations you use, then start a new agent session (or reload Pi). Ask your agent:

> Run Degreaser on my current changes. The task was to add CSV import. Wait for the review, assess the findings, and fix the ones that apply.

Or use the CLI:

```sh
degreaser-axi review --scope worktree --task "Add CSV import"
degreaser-axi report
```

`review` waits until the review ends. If your terminal or tool call stops first, the review keeps running: `degreaser-axi wait <run-id>` reattaches. Keep the code unchanged until it finishes. A partial review is not a clean result.

Reviews read source; they do not run tests or apply fixes. Review context goes to your selected model provider, uses its quota, and is saved locally in ignored `.degreaser/` files. All 18 reviewers run in parallel by default, each as one agent that explores the change itself and one that verifies its findings; use `--aspects` to select fewer or `--concurrency` to limit simultaneous sessions.

See `degreaser-axi --help` for commands and options, or `degreaser-axi doctor` for setup diagnostics. Details: [configuration and scopes](https://github.com/GR34SE/degreaser-axi/blob/main/docs/input-contract.md), [results and limitations](https://github.com/GR34SE/degreaser-axi/blob/main/docs/result-contract.md), [worker restrictions](https://github.com/GR34SE/degreaser-axi/blob/main/docs/harnesses.md).

## Review aspects

All 18 built-in aspects are enabled by default. Each reviewer checks one question. Reports list aspects in this order: simplicity first, then from the most to the least damaging slop.

| Aspect | Review question |
| --- | --- |
| `unnecessary-complexity` | Is this the simplest implementation possible? |
| `masked-errors` | Does a fallback turn failure into apparent success? |
| `verification-theater` | Does the check distinguish the valid and invalid states it claims to verify? |
| `contract-bypass` | Does a cast, suppression or default hide a real mismatch? |
| `incomplete-integration` | Is the new code connected to the real user path? |
| `stale-references` | Did the change leave repository text untrue, or silently drop a rule it did not ask to remove? |
| `low-value-tests` | Would this test detect broken behavior, or just confirm its own mock? |
| `scope-creep` | Did the change add features or refactoring outside the task? |
| `reinvented-infrastructure` | Does a handwritten cache, parser or similar mechanism miss required semantics? |
| `missed-reuse` | Does the repo or an existing dependency already solve this? |
| `wrong-abstraction` | Does a shared mechanism combine cases with conflicting rules? |
| `structural-erosion` | Does this change create or worsen coupling between responsibilities? |
| `speculative-flexibility` | Do these options and extension points serve a current requirement? |
| `unnecessary-layers` | Does this wrapper, service or factory add useful behavior or a boundary? |
| `unjustified-defense` | Does this check protect a real boundary or possible state? |
| `convention-drift` | Does this introduce another way to do the same thing without a reason? |
| `unidiomatic-code` | Can a native construct remove unnecessary logic without changing behavior? |
| `low-value-comments` | Does the comment prevent a trap that code cannot reveal? |

A wrapper, comment or validation check is not automatically a problem. Findings need a concrete consequence, and the verifier checks reasons to keep the code before a finding is upheld. See the [catalog and aspect boundaries](https://github.com/GR34SE/degreaser-axi/blob/main/docs/aspects.md) for details.

For a one-run subset of enabled aspects:

```sh
degreaser-axi review --scope worktree --task "Add CSV import" --aspects missed-reuse,low-value-tests
```

## Configuration

`init` writes `.degreaserrc.json` at the Git root. Keep the `agent`, `model` (finder) and `verifier` you confirmed there; without `verifier`, the finder model also verifies. `model` is a version pin, like the Codex example below, or a `(latest)` choice that tracks the newest version your installed harness offers; neither guarantees availability. See [latest models and version pins](https://github.com/GR34SE/degreaser-axi/blob/main/docs/input-contract.md).

```json
{
  "schemaVersion": 1,
  "agent": "codex",
  "model": "gpt-6-terra",
  "verifier": { "model": "gpt-6-sol" },
  "concurrency": 4,
  "maxRetries": 1,
  "limits": {
    "workerTimeoutSeconds": 900,
    "workerIdleSeconds": 180,
    "maxTurns": 40,
    "runTimeoutSeconds": 1800
  },
  "aspects": {
    "low-value-comments": true,
    "scope-creep": false
  },
  "exclude": ["vendor", "src/generated"]
}
```

- `concurrency: 4` caps simultaneous finder and verifier sessions, for example to stay under a provider rate limit. Without it, every selected aspect runs at once.
- `aspects` accepts `true` (enabled), `false` (disabled), or `{ "model": "<model>" }` to override the finder model for one aspect. Omitted aspects stay enabled. Changing its agent also requires an explicit compatible model.
- `maxRetries` counts extra attempts. The limits above are defaults; `maxTurns` is enforced natively only by Claude and is advisory for other workers.
- `exclude` adds literal repository-relative files or directory prefixes, not globs. It narrows assessed coverage, not worker read access.

`degreaser-axi config sync` fills missing settings with installed defaults without changing explicit choices. See the [configuration contract](https://github.com/GR34SE/degreaser-axi/blob/main/docs/input-contract.md) and [JSON schema](https://github.com/GR34SE/degreaser-axi/blob/main/src/config/config.schema.json) for the full format and bounds.

## License

[MIT](LICENSE)
