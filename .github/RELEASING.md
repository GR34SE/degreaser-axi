# Dependency updates and releases

Renovate updates dependencies. Release Please owns version selection, release
PRs, changelog entries and tags. GitHub Actions tests the release tarball and
publishes it through npm Trusted Publishing. There is no custom release engine.

**Publishing is not enabled by this configuration.** Both repository variables
below default to disabled when absent. Do not enable them until the owner has
authorized the corresponding external actions. An npm login on a developer's
computer neither enables nor prevents OIDC publishing from GitHub.

## One-time GitHub setup

1. Install the Renovate GitHub App for this repository only. The default
   unrestricted schedule lets the hosted app check on each service run; it is
   not a promise of a particular polling interval.
2. Enable GitHub auto-merge and squash merging. Require the stable
   **macOS deterministic** check on `main`, with branches up to date before
   merging. Never give either bot permission to bypass required checks.
3. If human approval is required, put that requirement in a separate ruleset
   with a PR-only bypass for Renovate and the release app. Keep required PRs
   and status checks in a ruleset without those bypasses. Do not remove review
   requirements for human changes.
4. Create a dedicated release GitHub App, installed only on this repository,
   with repository Contents, Pull requests and Issues write permissions.
   Store its app ID in `RELEASE_APP_ID` (Actions variable) and private key in
   `RELEASE_APP_PRIVATE_KEY` (Actions secret). Do not use a personal account
   token or the default `GITHUB_TOKEN` for release PRs: those PR events must
   trigger normal CI.
5. After Renovate is installed, disable **Dependabot security updates** in the
   repository settings and close superseded Dependabot PRs. Deleting
   `.github/dependabot.yml` stops version updates, but does not turn off this
   separate security-PR setting. Keep **Dependabot alerts** enabled.
   Renovate's recommended preset enables vulnerability-alert updates; the
   same age policy and required CI still apply.
6. When the owner authorizes release-PR automation, set the repository Actions
   variable `RELEASE_AUTOMATION_ENABLED=true`. This enables release PRs, their
   auto-merge, draft releases and artifact preparation, not npm publication.

Major dependency updates and minor updates to pre-1.0 packages are deliberately
not auto-merged. They stay visible for compatibility work. The bot never fixes
an incompatible API or bypasses a failed check. Deterministic and synthetic
checks do not prove native worker/model compatibility.

All npm dependencies remain exact pins. Releases must be at least seven days
old with a known publication timestamp. Install scripts stay disabled.
`@types/node` remains on Node 24. Toolchain upgrades must preserve the minimum
runtime, package-age policy and disabled build permissions.

## One-time npm setup, before enabling publication

1. Verify ownership/availability of `degreaser-axi` on npm and complete any
   first-publication bootstrap required by npm. Do not publish a placeholder
   or the first version without the owner's explicit publication approval.
2. Configure an npm Trusted Publisher for GitHub organization/user `GR34SE`,
   repository `degreaser-axi`, workflow **`release.yml`**, environment **`npm`**.
   Allow direct `npm publish`; staged publication would require an approval
   and is not this hands-off release flow.
3. Create the GitHub environment `npm`. Restrict deployment to `main`, without
   required human reviewers. Use GitHub-hosted runners. The publishing job
   uses OIDC with `id-token: write`, not an `NPM_TOKEN`.
4. Check the repository/package metadata and the package's licensing terms
   before the first public distribution. Provenance requires a public source
   repository and a matching `repository.url`.
5. Only after explicit authorization, set the repository Actions variable
   `NPM_PUBLISH_ENABLED=true`. Turning it off stops new publishing jobs;
   cancel an already running publishing job separately if necessary.

No app installation, secret, variable, repository setting or npm Trusted
Publisher is created by committing these files.

## Version policy

The checkout is prepared at `1.0.0`; the empty release manifest means no release
is claimed to have happened. Release Please's `initial-version` creates the
first release at `1.0.0`. Its bootstrap SHA is an existing `main` commit and
limits the first changelog range. Neither setting pins later releases.

| Commit | Product version |
| --- | --- |
| `fix(deps): update acpx ...` | Patch, e.g. `1.0.8` to `1.0.9` |
| `fix: ...` | Patch |
| `feat: ...` | Minor |
| `feat!: ...` / `BREAKING CHANGE` | Major |
| `chore(deps): ...`, docs and CI-only changes | No standalone release |

Renovate emits `fix(deps)` for runtime dependencies and `chore(deps)` for
development dependencies, package-manager updates and GitHub Actions. An
upstream dependency's major version does not determine our version. If an
upgrade changes our public contract, land that compatibility change with the
appropriate breaking-change marker.

Use conventional squash commit titles for ordinary PRs. Release Please
updates `package.json`, the annotated `src/version.ts`, `CHANGELOG.md` and its
manifest together. Do not hand-edit generated release versions/changelogs.

## Normal operation

1. Renovate opens a dependency PR after the age policy allows it.
2. Eligible updates auto-merge only after required CI passes.
3. A successful **Checks** run for a push to `main` starts **Release**.
4. Release Please opens/updates a release PR and enables its checked auto-merge.
5. After that PR merges and main CI passes, Release Please creates a tagged
   draft. The workflow checks out that tag, verifies it belongs to `main`,
   runs tests/types/lint, and tests an installed tarball on Node 24.0.0 and the
   pinned current Node 24. A publication dry run runs without publishing.
6. If npm publication is disabled, the workflow stops at the prepared artifact
   and draft. If enabled, a separate OIDC job downloads the exact artifact,
   verifies its checksum and publishes it. No checkout, install or repack runs
   in the privileged publishing job.
7. Only successful npm publication, or verification that the identical bytes
   already exist, allows the final job to upload assets and publish the GitHub
   draft. Releases are serialized and an in-flight release is not cancelled
   by a newer main push.

The GitHub workflow calls publication directly through job dependencies;
it does not rely on bot-generated tag/release events cascading into another
workflow.

## Failure and recovery

Failed checks stop automerge. Fix the incompatibility in the dependency PR;
do not approve a failed check or relabel a major upgrade to force a patch.

Use **Re-run failed jobs**, not **Re-run all jobs**, for a release failure.
That retains the original tag and successful upstream jobs. If publication
succeeded but GitHub finalization failed, only finalization needs retrying.

For a prepared draft created while publishing was disabled, or an expired
artifact, run **Release** from `main` with the existing `vX.Y.Z` tag input once
publication is authorized. This is recovery, not a normal release trigger.
Only existing draft releases whose tag belongs to `main` are accepted. The
version must match the package, and the tarball must pass validation again.

If that version exists on npm, the workflow verifies SHA-512 integrity against
the tested tarball before skipping the publish. A different artifact or
registry error fails explicitly. Never overwrite/reuse a published version,
move a release tag, or unpublish as routine recovery. Correct bad shipped code
through a new patch release.

Local preparation remains available through `pnpm release:prepare --since
<ancestor> --output <new-directory>` and never publishes.
