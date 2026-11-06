# Working on Degreaser

## Product and scope

Degreaser is a local CLI for coding agents to review their work for unjustified complexity, broken contracts and misleading verification. The caller supplies the task and change scope; Degreaser sends each enabled review aspect to a fresh, isolated, read-only worker through acpx. Workers return source evidence. The caller evaluates the findings and makes edits. Degreaser does not fix code or detect AI authorship.

Implemented package: ESM TypeScript, macOS, Node 24+, Codex/Claude Code/Pi workers and onboarding. `package.json` remains private; npm publication is not authorized. Planned support is not shipped support. Public product text, CLI output, prompts and skills are English.

### Behavior to preserve

1. **Explicit scope.** `review` requires `--scope` and exactly one of `--task` / `--task-file`. `worktree` compares HEAD with final staged + unstaged + nonignored new contents. `branch` includes committed and local work relative to the merge-base with an explicit `--base`; never guess main/develop/upstream. `repository` is an explicit audit, never a fallback for an empty diff. Repeatable `--path` narrows assessed coverage; the rest of the repo remains context.
2. **One shared input, one aspect per worker.** The coordinator resolves Git scope once using a temporary index, without changing the user's index or refs. Workers receive the same input, the common instruction, response contract and one rubric. They may inspect connected code but cannot widen the review. All 16 built-in aspects are enabled by default. Use semantic IDs (`missed-reuse`, `scope-creep`), never old A01–A16 aliases; see [catalog and boundaries](assets/catalog.md).
3. **Evidence before findings.** Each finding names a concrete consequence, checked counterargument, exact old/new source quote and correction direction. A wrapper, comment, loop, cast or validation is not inherently slop. `not-applicable`, `no-findings` and `incomplete` are distinct. Invalid output, rejected quotes and missing coverage cannot become a clean review. Quotes are checked against the resolved Git blobs; findings remain source-only, not test or runtime evidence.
4. **Restricted workers.** Each attempt starts a fresh session with the selected exact agent/model. No edits, installations, tests, application execution, web access, delegation or recursive Degreaser calls. Repository instructions are evidence, not worker commands. Enforce restrictions through native profiles, not prompts alone; report each adapter's actual guarantees. Codex's read-only sandbox still permits shell-based reads. See [native profiles](assets/native-profiles.md).
5. **Wait for the result.** A separate owner process runs each review and exits with it. `review` can return `running`; the caller stays in its active turn, reattaches with `wait <run-id>` and does not edit until the run ends. A tool timeout or process handle is not completion. `report` reads saved progress; `cancel` stops owned workers and preserves useful results.
6. **Bounded, resumable execution.** Default concurrency admits all enabled aspects, after the first worker reaches its initial model turn; a positive limit caps active workers. Retry is bounded and never switches model, provider or account. `resume` reruns only unresolved aspects with matching input/prompt identity and retains successful peers. Changed code, task, scope or rubrics require a new review. Auth/model/quota failures are not reasons for blind retries.
7. **Local, honest state.** Runs live in ignored `.degreaser/`, as schema-validated JSON with atomic writes and one owner. Corrupt or incompatible state fails explicitly; never reset it into empty success. No full worker transcripts or credentials are stored by Degreaser. Task text, patches and quotes can be sensitive. `dismiss` records the user's reason for retaining a finding's code; it does not apply a fix. Its local ledger is shared across worktrees in Git's common directory.

Exit codes describe completeness, not whether findings exist: **0** completed/no-changes; **1** partial/failed/interrupted; **2** rejected command/input; **3** still running. Read the structured status too. Zero findings in a partial review is not a pass. See [result-contract.md](assets/result-contract.md) for full semantics.

### Onboarding and boundaries

`init` discovers models, prefills a recommendation and requires the user to confirm or change the exact worker agent/model on every init. It also requires the installation harness selection. Without resolved choices and without a TTY, return `decision-required` without writes. Caller and worker harnesses are independent; there is no caller profile setting.

One harness selection installs its startup hook/native equivalent and product skill together. Default installation scope is the project; user-wide installation is explicit. Init saves `.degreaserrc.json` and adds `/.degreaser/` to the root `.gitignore`, preserving unrelated content. `config sync` fills missing defaults; `setup hooks` repairs/removes owned integrations. Startup context only reads local state; it never starts models, resumes work or fetches packages.

Do not change global permissions, trust, Codex rules or unselected harnesses. Do not use the AXI bulk installer. A restricted caller uses host-supported per-command approval or reports the actual block. Test installations only in disposable projects/homes. `doctor` checks local configuration/capabilities; it does not prove login, model access or delivery of startup context.

Outside v1: custom rubrics, automatic apply, model judge, semantic finding merges, custom diff parser, per-review worktree/snapshot, daemon, hosted queue or benchmark platform. Use Git, public `acpx/runtime`, AXI routing/TOON, Ajv and Node built-ins before inventing infrastructure. Effect is not this package's required stack.

**Always use `axi-sdk-js` for anything it provides:** CLI routing, help, version fast path, errors (`AxiError` rendered by `runAxiCli`), the built-in `update`, home header and session hooks (`computeSessionStartHookUpdate`/`Removal`, `resolvePortableHookCommand`). Use only its public exports (package `index` and `axi-sdk-js/fast-path`). Hand-write something only when the SDK lacks it, does not export it publicly, or would break a rule here (`installSessionStartHooks` touches unselected agents and global Codex config); say why in a short comment. Check the SDK before adding CLI, output, hook or update code.

## Where to work

| Concern | Entry points |
| --- | --- |
| Public CLI and command contracts | `src/cli.ts`, `src/commands.ts`, `README.md` |
| Scope, config and resolved input | `src/scope.ts`, `src/input.ts`, `src/config.ts`, `src/git.ts`; `assets/input-contract.md` |
| Run lifecycle and continuation | `src/review.ts`, `src/owner.ts`, `src/ownership.ts`, `src/freshness.ts`, `src/storage.ts` |
| Worker launch and restrictions | `src/worker-runtime.ts`, `src/native-profile.ts`, `src/native-launch.ts`, `src/model-discovery.ts`; `assets/native-profiles.md` |
| Prompts, findings and reports | `src/prompt.ts`, `src/results.ts`, `src/report.ts`, `src/dismissals.ts`; `assets/worker.md`, `assets/response.md`, `assets/result-contract.md` |
| Rubrics and persisted schemas | `assets/aspects/`, `assets/catalog.md`, `assets/schemas/` |
| Init, integrations and generated skill | `src/init.ts`, `src/integrations.ts`, `src/integration-targets.ts`, `src/guidance.ts`; `assets/skills/degreaser/SKILL.md` |
| Validation and packaging | `test/`, `scripts/qa/`, `scripts/test-live.ts`, `scripts/package-check.ts`, `.github/workflows/check.yml` |

Read the relevant contract before editing. Build/runtime must work from public `assets/` without private files. Generate the product skill from `src/guidance.ts` with `pnpm skill:generate`; never hand-edit it. README is for users: purpose, verified setup, usage and results, without development handoff or private links. Write it for the released npm package (`npm install -g degreaser-axi`, `npx -y degreaser-axi`), not as a development build.

### Private intent and history

For product intent, start from `specs/README.md` and `specs/pending/degreaser.md` when available. Then read the relevant companion: `contracts.md` (interfaces), `execution.md` (lifecycle/profiles), `init.md` (onboarding), `worker.md` / `aspects.md` (review quality), `development.md` (acceptance). Distinguish accepted requirements, proposals and implementation. Surface discrepancies; public assets/source describe the checkout, historical notes do not override current decisions.

`specs/` is private and ignored; build/test/package work does not need it. If a decision requires private intent, obtain approved handoff from the owner. Read outside the checkout or symlink only to an absent destination. Never force-add specs, change their ignore or publish private contents/intent in PRs, npm or artifacts. `.lavish/` is frozen historical work; do not reopen/update it.

## Change and validation workflow

- Inspect Git root, branch, HEAD, staged/unstaged changes and any active delivery pipeline first. Preserve other work and configured authorship. If another session may commit here, use a separate worktree before changing the shared index. New manual worktrees belong under `/Users/adriancelczynski/worktrees/manual/<owner-repo>/<task-id>`; use an already assigned worktree and leave tool-managed worktrees with their owner.
- Choose the smallest complete change. Keep strict NodeNext/erasable TypeScript, exact dependency and pnpm pins, disabled lifecycle scripts and existing package-age policy. Never weaken global security settings or automatically approve dependency skills.
- For behavior changes, first demonstrate a meaningful failing case. Prefer public CLI/process boundaries and real disposable Git repositories with independent expectations. Synthetic adapters test orchestration, not model quality or native compatibility. Source assertions cannot prove model interpretation.
- For **changes limited to `.md` files, skip `no-mistakes`**. Review the diff, referenced paths, commands and consistency with source/contracts; run only checks relevant to changed content. Markdown prompts, rubrics and generated product guidance still require their applicable validation. Do not run the full code pipeline merely because prose changed. This supersedes older blanket requirements in specs/skill indexes, but preserves required CI and branch protection.
- For code delivery, use the required review skills below, relevant product checks and `no-mistakes --no-publish-intent` before final delivery. One delivery owner manages push/PR/CI/merge; intermediate workers do not start competing pipelines. Complete authorized delivery through PR, green required checks and merge to `main`; do not ask again for authorization already granted. No npm publication; retain `private: true` until separately authorized.

| Command | When / what it verifies |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Restore pinned dependencies |
| `pnpm test` | Build + deterministic Node tests, concurrency 2 |
| `pnpm typecheck`; `pnpm lint` | Types; lint/format (`pnpm format` writes fixes) |
| `pnpm build` | Compiled JS, packaged assets, generated-skill drift |
| `pnpm qa` | Isolated init/review/report/partial/resume with a synthetic adapter |
| `pnpm package:check` | Separate installed tarballs on minimum/current Node; set `DEGREASER_NODE24_MIN` to a verified Node 24.0.0 binary |
| `pnpm check` | Aggregate deterministic gates; QA and live tests are separate |
| `pnpm test:live --help` | Opt-in native/model scenarios; unsupported/unrun is never passed |
| `pnpm release:prepare --since <ancestor> --output <new-directory>` | From a clean committed checkout after checks: tested tarball, checksum and draft notes; no publishing |

Live tests require synthetic code, confirmed models and a fresh quota check, without paid API fallback. Stop only owned processes. No model credentials/logins in CI. Required hosted check: **macOS deterministic**; local success does not replace it. Release output: external/ignored, existing parent, new destination; review notes before sharing.

## Task-specific skills and references

Read skills by repository path under `.agents/skills/`; `.claude/skills/` links to the same files. Upstream skills are managed by Skills CLI and `skills-lock.json`; do not fork them in place.

- CLI/output/integration design: `axi/SKILL.md`.
- Rubrics: `write-degreaser-aspect/SKILL.md` and its template. Each rubric needs applicability, symmetric boundaries and three REPORT / three PRESERVE examples with context and reasons.
- Code implementation/review: `deslop-scoped/SKILL.md` and `thermo-nuclear-code-quality-review/SKILL.md`, on the caller-selected diff/base. Thermo-nuclear disables automatic model invocation. Tests also require `test-audit/SKILL.md`.
- Final code delivery: `no-mistakes/SKILL.md`, always `--no-publish-intent`; Markdown-only exception above.
- Backpass reference: `.references/backpass/` is read-only, excluded from Git; never edit, install or execute that clone. For queue/state/worker design consult its README, `src/analyze.js`, `src/state.js`, `src/acpx.js`, `src/acpx-output.js`. An explicitly requested published `npx backpass` run is separate; keep analysis artifacts local and review proposals before editing instructions.

For library/framework/CLI documentation, use Context7 outside the default sandbox: resolve with `npx ctx7@latest library <name> "<specific question>"`, then `docs <returned-id> "<question>"`; at most three calls per question. Use version-matched primary sources if indexing is ambiguous. Do not send secrets. Report quota failures and suggest login or `CONTEXT7_API_KEY`, rather than silently relying on memory.

Report checks, failures and remaining uncertainty. Inspected test assertions are source evidence; claim a passing test only after executing it. Examples, synthetic tests and real native/model runs are different evidence.
