<p align="center">
  <img src="https://raw.githubusercontent.com/GR34SE/degreaser-axi/main/assets/branding/degreaser.png" alt="Degreaser — Removes slop!" width="760">
</p>

# Degreaser

Code review for coding agents. Degreaser checks for unnecessary complexity, broken contracts and misleading verification. It runs 16 focused reviewers in fresh, read-only sessions and returns findings with code quotes and suggested corrections. Your agent decides what to fix.

## Install

Requires macOS, Node 24+, Git, pnpm, and a logged-in Codex, Claude Code, Pi or Cursor. Claude Code, Pi and Cursor must be on PATH; the Codex worker is bundled.

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

Reviews read source; they do not run tests or apply fixes. Review context goes to your selected model provider, uses its quota, and is saved locally in ignored `.degreaser/` files. All 16 reviewers run by default; use `--aspects` to select fewer or `--concurrency` to limit simultaneous calls.

See `degreaser-axi --help` for commands and options, or `degreaser-axi doctor` for setup diagnostics. Details: [review aspects](https://github.com/GR34SE/degreaser-axi/blob/main/assets/catalog.md), [configuration and scopes](https://github.com/GR34SE/degreaser-axi/blob/main/assets/input-contract.md), [results and limitations](https://github.com/GR34SE/degreaser-axi/blob/main/assets/result-contract.md), [worker restrictions](https://github.com/GR34SE/degreaser-axi/blob/main/assets/native-profiles.md).

## License

[MIT](LICENSE)
