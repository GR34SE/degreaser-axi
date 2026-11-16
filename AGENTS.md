# Working on Degreaser

## Product and scope

Degreaser is a local CLI for coding agents to review their work for unjustified complexity, broken contracts and misleading verification. The caller supplies the task and change scope; Degreaser runs one fresh, isolated, read-only finder agent per enabled review aspect, which explores the scope itself, then one separate verifier agent per aspect with candidates that tries to refute each one, through acpx. Workers return source evidence. The caller evaluates the findings and makes edits. Degreaser does not fix code or detect AI authorship.

Implemented package: ESM TypeScript, Linux and macOS, Node 24+, Codex/Claude Code/Pi/Cursor workers and onboarding. The package is prepared for public v1 distribution. Actual npm publication is not yet authorized: leave `NPM_PUBLISH_ENABLED` unset or false until the owner explicitly enables it. Local npm login is not a publication gate because CI uses OIDC. Planned support is not shipped support. Public product text, CLI output, prompts and skills are English.

### Behavior to preserve

1. **Explicit scope.** `review` requires `--scope` and exactly one of `--task` / `--task-file`. `worktree` compares HEAD with final staged + unstaged + nonignored new contents. `branch` includes committed and local work relative to the merge-base with an explicit `--base`; never guess main/develop/upstream. `repository` is an explicit audit, never a fallback for an empty diff. Repeatable `--path` narrows assessed coverage; the rest of the repo remains context.
2. **One shared input, independent finder and verifier sessions.** The coordinator resolves Git scope once using a temporary index, without changing the user's index or refs, and writes the resolved patch file. Per aspect, one finder session (the top-level agent/model, with per-aspect overrides) receives the task, scope, at most 40 work paths, a reference to the complete assessed-path list and the patch reference, but no inline source or diff, and explores the scope itself under the common instruction, response contract and one rubric. After each finder round, quote-checked candidates enter that aspect's queue. At five queued candidates or finder completion, batches of at most ten start fresh verifier sessions (the `verifier` identity, defaulting to the finder's); they can overlap finding and each other. Both read repository convention files as evidence and may inspect connected code, but cannot widen the review. All 18 built-in aspects are enabled by default; `ASPECT_IDS` order is their review priority (`unnecessary-complexity` first, then the most to the least damaging slop). Use semantic IDs (`missed-reuse`, `scope-creep`), never old A01–A16 aliases; see [catalog and boundaries](docs/aspects.md).
3. **Evidence before findings.** A finder candidate carries a location, an exact old/new source quote and a title; it is not a finding to act on until the verifier upholds it with an action or refutes it with a reason (optionally with a quoted counter-source). A candidate without a valid verdict is `unverified`. A wrapper, comment, loop, cast or validation is not inherently slop. `not-applicable`, `no-findings` and `incomplete` are distinct. Only a finder that failed, timed out, returned invalid output or reported itself incomplete leaves its aspect `incomplete` and the run `partial`. A rejected quote drops only that candidate. Unverified candidates appear in their own default-report section and unexamined paths are listed per aspect; neither makes a run partial, and neither is a pass. Coverage is declared by the finder (`examinedPaths`). Quotes are checked against the resolved Git blobs; findings remain source-only, not test or runtime evidence.
4. **Restricted workers.** Each attempt, finder or verifier, starts a fresh session with the selected exact agent/model. Workers read files and may run read-only `git` (diff, log, show, status, ls-files, cat-file, merge-base, rev-parse) on every harness, plus blame and grep except on Claude Code, which uses its native search tool instead of `git grep`. No edits, installations, tests, application execution, web or `gh` access, delegation or recursive Degreaser calls. Repository instructions are evidence, not worker commands. Enforce restrictions through native profiles, not prompts alone; report each adapter's actual guarantees. Codex's read-only sandbox still permits shell-based reads. See [native profiles](docs/harnesses.md).
5. **Wait for the result.** A separate owner process runs each review and exits with it. `review`, `wait` and `resume` block until the run ends; only an explicit `--wait <seconds>` returns `running`, with one deliberate safeguard: a blocking wait also returns `running` (exit 3) once the run deadline plus 60 s has passed with the owner still alive. After a tool timeout the caller stays in its active turn, reattaches with `wait <run-id>` and does not edit until the run ends. A tool timeout or process handle is not completion. `report` reads saved progress; `cancel` stops owned workers and preserves useful results.
6. **Bounded, resumable execution.** All aspect tasks start one finder each. The default active-session cap is twice the selected aspect count, with at most that aspect count in verifier sessions; `concurrency` is only an optional positive cap (`null` is rejected). The rest start after the first worker reaches its first model turn or after 15 s. By default workers stop after 180 s idle or a 900 s ceiling and runs end at 1800 s. Retry is bounded and never switches model, provider or account; valid verifier verdicts survive lifecycle failures, and candidates without verdicts get one recovery attempt in batches at most half the original size (minimum one), except for auth/model/account/quota/permission failures, unsafe cleanup or run stops. `resume` reruns failed finders on only their unaccounted-for paths and re-verifies unverified candidates with matching input/prompt identity, retaining candidates, verdicts and successful peers. Changed code, task, scope or rubrics require a new review. Auth/model/quota failures are not reasons for blind retries. Explicit temporary throttling gets one retry after a 2-second pause, within the finder budget or the verifier's one recovery, with the shared session cap halved once per owner execution. Unknown HTTP 429 responses are not assumed transient.
7. **Local, honest state.** Runs live in ignored `.degreaser/`, as schema-validated JSON with atomic writes and one owner. Corrupt state fails explicitly; never reset it into empty success. Runs saved by another version (run state v2 here) are skipped with a note when selecting the latest run and fail as incompatible only when requested by ID. No full worker transcripts or credentials are stored by Degreaser. Task text, patches and quotes can be sensitive. `dismiss` records the user's reason for retaining a finding's code; it does not apply a fix. Its local ledger is shared across worktrees in Git's common directory.

Exit codes describe completeness, not whether findings exist: **0** completed/no-changes; **1** partial/failed/interrupted; **2** rejected command/input; **3** still running. Read the structured status too. Zero findings in a partial review is not a pass. See [result-contract.md](docs/result-contract.md) for full semantics.

### Onboarding and boundaries

`init` discovers models, prefills a recommendation and requires the user to confirm or change the finder agent/model on every init. A separate verifier is optional: non-TTY init without verifier flags omits `verifier`, inheriting the finder; interactive init offers a verifier recommendation. Latest choices precede version pins: Claude retains advertised native family aliases; Codex `latest:<family>` resolves before a new run and stays pinned for its attempts/resumes. Exact model IDs never auto-migrate. Init also requires the installation harness selection. Without resolved choices and without a TTY, return `decision-required` without writes. Caller and worker harnesses are independent; there is no caller profile setting.

One harness selection installs its startup hook/native equivalent and product skill together. Default installation scope is the project; user-wide installation is explicit. Init saves `.degreaserrc.json` and adds `/.degreaser/` to the root `.gitignore`, preserving unrelated content. `config sync` fills missing defaults; `setup hooks` repairs/removes owned integrations. Startup context only reads local state; it never starts models, resumes work or fetches packages.

Do not change global permissions, trust, Codex rules or unselected harnesses. Do not use the AXI bulk installer. A restricted caller uses host-supported per-command approval or reports the actual block. Test installations only in disposable projects/homes. The CLI works across Codex, Claude, Pi and Cursor without caller configuration. `doctor` checks local configuration/capabilities; it does not prove login, model access or delivery of startup context.

Outside v1: custom rubrics, automatic apply, semantic finding merges, custom diff parser, per-review worktree/snapshot, daemon, hosted queue or benchmark platform. Use Git, public `acpx/runtime`, AXI routing/TOON, Ajv and Node built-ins before inventing infrastructure. Effect is not this package's required stack.

**Always use `axi-sdk-js` for anything it provides:** CLI routing, help, version fast path, errors (`AxiError` rendered by `runAxiCli`), the built-in `update`, home header and session hooks (`computeSessionStartHookUpdate`/`Removal`, `resolvePortableHookCommand`). Use only its public exports (package `index` and `axi-sdk-js/fast-path`). Hand-write something only when the SDK lacks it, does not export it publicly, or would break a rule here (`installSessionStartHooks` touches unselected agents and global Codex config); say why in a short comment. Check the SDK before adding CLI, output, hook or update code.

## Where to work

| Concern | Entry points |
| --- | --- |
| Public CLI and command contracts | `src/cli/`, command-local specs and handlers in `src/cli/commands/`; `README.md` |
| Scope, config and resolved input | `src/review/prepare/`, `src/config/`, `src/util/git/`; `docs/input-contract.md` |
| Run lifecycle and continuation | `src/review/owner/`, `src/review/attempt/`, `src/state/` |
| Worker launch and restrictions | `src/modules/harness/`, per-harness launchers and profiles; `docs/harnesses.md` |
| Prompts, findings and reports | `src/review/attempt/prompt/`, `src/review/ingest/`, `src/report/`, `src/state/`; `docs/result-contract.md` |
| Rubrics and persisted schemas | `src/modules/aspect/`, schemas colocated with their owning domain; `docs/aspects.md` |
| Init, integrations and generated skill | `src/cli/commands/init/`, `src/install/`, `src/install/skill/`; build renders `dist/install/skill/SKILL.md` |
| Validation and packaging | Colocated `src/**/*.test.ts`, `test/e2e/`, `test/docs/`, `test/qa/`, `test/package/`, opt-in `test/live/` and `test/install/`; build/release tools in `tools/` |

Read the relevant contract before editing. Build/runtime must work from public colocated resources without private files. Build mirrors these resources into `dist/`. Generate the product skill from `src/install/skill/guidance.ts` with `pnpm skill:generate`; never hand-edit it. Keep README short and written for users: purpose, requirements, working installation, one basic workflow, essential limitations and license. Link to existing public contracts for configuration, commands and review details instead of duplicating them. Contributor instructions, validation procedures and project design rules belong in AGENTS.md, not README. Do not add development handoff or private links. Until publication is separately authorized, document the working checkout installation and label registry installation as unavailable. Do not describe an unpublished package as released.

### Private intent and history

For product intent, start from `specs/README.md` and `specs/pending/degreaser.md` when available. Then read the relevant companion: `contracts.md` (interfaces), `execution.md` (lifecycle/profiles), `init.md` (onboarding), `worker.md` / `aspects.md` (review quality), `development.md` (acceptance). Distinguish accepted requirements, proposals and implementation. Surface discrepancies; public assets/source describe the checkout, historical notes do not override current decisions.

`specs/` is private and ignored; build/test/package work does not need it. If a decision requires private intent, obtain approved handoff from the owner. Read outside the checkout or symlink only to an absent destination. Never force-add specs, change their ignore or publish private contents/intent in PRs, npm or artifacts. `.lavish/` is frozen historical work; do not reopen/update it.

## Change and validation workflow

- Inspect Git root, branch, HEAD, staged/unstaged changes and any active delivery pipeline first. Preserve other work and configured authorship. If another session may commit here, use a separate worktree before changing the shared index. New manual worktrees belong outside this checkout, one per task; use an already assigned worktree and leave tool-managed worktrees with their owner.
- Choose the smallest complete change. Keep strict NodeNext/erasable TypeScript, exact dependency and pnpm pins, disabled lifecycle scripts and existing package-age policy. Never weaken global security settings or automatically approve dependency skills.
- Default to no explanatory code comments. Keep only a concise warning about a concrete maintenance or usage trap whose cause cannot be derived from the code and its callers. Public exports, docstrings and visible error contracts are not exemptions. Preserve legally required notices and verified machine-consumed directives as operational content, not narration.
- For behavior changes, first demonstrate a meaningful failing case. Prefer public CLI/process boundaries and real disposable Git repositories with independent expectations. Synthetic adapters test orchestration, not model quality or native compatibility. Source assertions cannot prove model interpretation.
- For **changes limited to `.md` files, skip `no-mistakes`**. Review the diff, referenced paths, commands and consistency with source/contracts; run only checks relevant to changed content. Markdown prompts, rubrics and generated product guidance still require their applicable validation. Do not run the full code pipeline merely because prose changed. This supersedes older blanket requirements in specs/skill indexes, but preserves required CI and branch protection.
- For code delivery, use the required review skills below, relevant product checks and `no-mistakes --no-publish-intent` before final delivery. One delivery owner manages push/PR/CI/merge; intermediate workers do not start competing pipelines. Complete authorized delivery through PR, green required checks and merge to `main`; do not ask again for authorization already granted. Preparing the public package does not authorize publishing it or enabling `NPM_PUBLISH_ENABLED`.

| Command | When / what it verifies |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Restore pinned dependencies |
| `pnpm test` | Build + deterministic Node tests, concurrency 2 |
| `pnpm typecheck`; `pnpm lint` | Types; lint/format (`pnpm format` writes fixes) |
| `pnpm build` | Compiled JS, mirrored resources, registry-derived schema vocabularies and limits, generated-skill drift |
| `pnpm qa` | Isolated init/review/report/partial/resume with a synthetic adapter |
| `pnpm package:check` | Separate installed tarballs on minimum/current Node; set `DEGREASER_NODE24_MIN` to a verified Node 24.0.0 binary |
| `pnpm check` | Aggregate deterministic gates; QA and live tests are separate |
| `pnpm test:tooling` | Deterministic tests for the opt-in live tooling, without model inference |
| `pnpm test:install --harnesses codex,claude,pi,cursor` | After build: native installation discovery in disposable homes, no inference; select installed harnesses. Cursor's ACP session does not run sessionStart; the check proves that hook with the logged-in CLI on a disposable repo |
| `pnpm test:live --help` | Opt-in native/model scenarios; unsupported/unrun is never passed |
| `node test/live/support/cleanup-benchmark.ts <repository> <commit> <export.json> [path-prefix...]` | Scores an exported `low-value-comments` audit of `<commit>^` against the comment blocks that `<commit>` removed (recall) and kept (precision); reads Git and the export only, starts no model |
| `pnpm release:prepare --since <ancestor> --output <new-directory>` | From a clean committed checkout after checks: tested tarball, checksum and draft notes; no publishing |

Live tests require synthetic code, confirmed models and a fresh quota check, without paid API fallback. Stop only owned processes. No model credentials/logins in CI. The opt-in fleet resource monitor reads macOS memory-pressure interfaces and refuses other hosts. Required hosted check: **macOS deterministic**; local success does not replace it.

CI runs build, typecheck, lint, the deterministic suite and installed-package
QA in one Linux job, and the deterministic suite plus installed-package QA in
one macOS job; keep each PR to one macOS job. Non-PR runs also accept minimum
Node 24.0.0 on both systems. Repository
variables `CI_LINUX_RUNNER` / `CI_MACOS_RUNNER` may name self-hosted runner
labels; unset, jobs use GitHub-hosted runners. Fork PRs always use
GitHub-hosted runners. Never commit
machine names, local paths or other private infrastructure details.
CI selects documentation contracts only for PRs changing root `README.md` and/or
`AGENTS.md`; static checks and current-Node installed-package QA still run.
Any other path, empty diff or unavailable history runs all tests, concurrency 4.
Keep the allowlist conservative; assets, guidance, dependencies and workflow
changes require full coverage. All jobs must pass the aggregate; failure,
cancellation or skipping cannot pass.
Every push to main, nightly schedule and manual dispatch runs the full suite
and installed-package QA on minimum Node 24.0.0 plus pinned current Node 24.
PRs defer only minimum-runtime acceptance. `pnpm check` and release preparation
retain both runtimes by default. CI caches the pnpm store by lockfile and builds
once per job. Release output: external/ignored, existing parent, new destination; review notes before sharing.

### Dependency and release automation

Renovate is the sole dependency updater; do not restore Dependabot version
updates. Preserve exact pins, disabled lifecycle scripts and the seven-day
minimum release age. Stable patch/minor updates and digest pins may auto-merge
after required CI; major updates and every update to an npm package whose
current version is 0.x require compatibility work. Keep `@types/node` on the supported Node 24 major.

Release Please owns versions, `CHANGELOG.md`, tags and release PRs. Runtime
dependency updates use `fix(deps)` (patch); development and CI updates use
`chore(deps)` (no standalone product release). Features and breaking changes
retain normal SemVer. Do not hand-increment versions or write a release engine.
Use its `extra-files` updater for the annotated `src/version.ts`.

The release workflow is disabled unless `RELEASE_AUTOMATION_ENABLED=true`.
Actual npm publication additionally requires `NPM_PUBLISH_ENABLED=true` and
the npm Trusted Publisher setup. Never enable either on the owner's behalf
without explicit authorization. Keep publication in `release.yml`, publish the
tested tarball without repacking, and finalize GitHub Releases only after npm
succeeds. See [.github/RELEASING.md](.github/RELEASING.md) for activation and
recovery. `--no-publish-intent` hides private task intent in PR text; it does not
disable npm publication.

## Task-specific skills and references

Read skills by repository path under `.agents/skills/`; `.claude/skills/` links to the same files. Upstream skills are managed by Skills CLI and `skills-lock.json`; do not fork them in place.

- CLI/output/integration design: `axi/SKILL.md`.
- Rubrics: `write-degreaser-aspect/SKILL.md` and its template. Each rubric needs applicability, symmetric boundaries and three REPORT / three PRESERVE examples with context and reasons.
- Code implementation/review: `deslop-scoped/SKILL.md` and `thermo-nuclear-code-quality-review/SKILL.md`, on the caller-selected diff/base. Thermo-nuclear disables automatic model invocation. Tests also require `test-audit/SKILL.md`.
- Final code delivery: `no-mistakes/SKILL.md`, always `--no-publish-intent`; Markdown-only exception above.
- Backpass reference: `.references/backpass/` is read-only, excluded from Git; never edit, install or execute that clone. For queue/state/worker design consult its README, `src/analyze.js`, `src/state.js`, `src/acpx.js`, `src/acpx-output.js`. An explicitly requested published `npx backpass` run is separate; keep analysis artifacts local and review proposals before editing instructions.

For library/framework/CLI documentation, use Context7 outside the default sandbox: resolve with `npx ctx7@latest library <name> "<specific question>"`, then `docs <returned-id> "<question>"`; at most three calls per question. Use version-matched primary sources if indexing is ambiguous. Do not send secrets. Report quota failures and suggest login or `CONTEXT7_API_KEY`, rather than silently relying on memory.

Report checks, failures and remaining uncertainty. Inspected test assertions are source evidence; claim a passing test only after executing it. Examples, synthetic tests and real native/model runs are different evidence.
