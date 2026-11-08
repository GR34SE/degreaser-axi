# Native review workers

Workers use public `acpx/runtime` 0.21.1 and installed, pinned official adapters.
No adapter is downloaded at review time. Each attempt creates a fresh session,
checks that the exact selected model is advertised and selected before sending
a prompt, and shuts down and joins the runtime's owned process tree.

Before run admission, metadata-only sessions discover the catalogs needed for
the selected identities. They use the same isolation and environment, never
send prompts, and await owned transport cleanup. Claude discovery omits the
native `--model` flag because it would advertise even an unsupported requested
ID as a custom model. This does not change the exact selection for review turns.
Pi discovery omits provider/model flags and reads its independent configured
catalog through the official adapter's native metadata API. Neither discovery
path sends inference to a native default. Review turns retain exact argv pinning;
Pi never calls a persistent model setter.
See [input-contract.md](input-contract.md) for refusal semantics.

| Harness | Adapter / native version | Effective restriction |
| --- | --- | --- |
| Codex | codex-acp 2.5.0 / bundled Codex 0.165.0 | Read-only filesystem sandbox, never approval, code mode for reads; project documentation, hooks, delegation, apps, web search and MCP disabled by the profile |
| Claude Code | claude-agent-acp 0.95.0 / Claude 2.1.317 | Native Read/Grep/Glob tools only; no settings sources, slash commands/skills, project hooks or MCP; safe mode |
| Pi | pi-acp 0.0.33 / Pi 1.4.0 | Native read/grep/find/ls only; skills, extensions, MCP, context files and templates disabled |
| Cursor | native ACP / Cursor CLI 2026.11.05-86047df | Ask/read-only mode, sandbox enabled, writes denied by the ACP client; no separate adapter package |

Native versions are checked before dispatch. Codex is bundled and must match
exactly. Claude and Pi accept the verified version or newer within the same
major; Cursor accepts the verified release date or later. Any other accepted
version (including another Cursor build on the verified date) is allowed but
reported as an unverified-newer-version notice in
`doctor`, `init` discovery and `review`; older versions and other majors are
refused. Claude and Pi must already be installed and
authenticated; Cursor uses `cursor-agent` or `agent` on PATH. Executables resolve from absolute PATH entries, not a developer's
hard-coded home directory. Their native launchers replace themselves with the
verified executable, preserving the official adapter's streaming and process
ownership.

`doctor` reports the configured identities (including enabled overrides), accepted
and observed native versions, and local integration integrity in both
project and user scopes. It runs version checks only, not adapter sessions or
hidden model tests. `versionSource` distinguishes the pinned Codex package
manifest from Claude/Pi/Cursor executable version output. Codex's executable is
exercised by installed-package acceptance; doctor does not run it to corroborate
the manifest. Installed files are not proof of host trust, reload, hook
delivery, authentication or network access. Explicit local hook-disable settings
are observations, not a claim to have evaluated managed policy.

A Claude, Pi or Cursor version below the minimum (or another Claude/Pi major) fails
closed before review admission. Point
PATH at an already installed accepted version, or use a Degreaser release
that has revalidated the observed version. Degreaser never updates or downgrades
the global CLI or switches models to get past this refusal.

An authorized caller uses the ordinary review command without escalation.
An actual permission denial requires host-supported approval for that command
only, or an authorized session/terminal. No permission rules or global policy
changes are installed. Sandbox names and network hints alone are not denials.
Admission reports permission, authentication, network, model and unverified
runtime causes separately; local reads remain available where permitted.

Codex's empty MCP configuration table does not erase inherited entries. Its
launcher uses the native read-only MCP listing, then disables active entries in
invocation-local configuration with inert transports. No credential-bearing
transport settings are copied into argv, and no user configuration is rewritten.

The environment is allowlisted, retaining native subscription configuration roots
without copying credentials. Direct API keys, routing overrides and inherited
acpx auth grants are not forwarded. Codex requires ChatGPT login. Claude preserves
managed policy and refuses credential/routing overrides injected into its native
launch. Pi pins its provider-qualified model in argv, never through a settings-
persisting model RPC. There is no default-model, provider or metered API fallback.

All workers receive `DEGREASER_WORKER=1` and the packaged source-only instruction.
They must not edit, run tests/application code, install, delegate, browse or invoke
Degreaser. The coordinator supplies one assigned rubric, the resolved scope/task
and response contract. Repository text is evidence, not authority.

## Limits and honest evidence

- Advertised models and selected identities are metadata, not a provider-access
  guarantee. Claude's review-time `--model` seeds its catalog with the requested
  ID; that runtime check cannot independently detect a model withdrawn after
  admission. Pi's offline startup can use cached catalog data. Provider/auth
  failures may first surface during a turn; no check predicts future availability.
- Codex's read-only sandbox **is not a no-exec sandbox**. It permits shell/code
  execution used for reading. User skills and managed policy may remain visible.
- Claude and Pi tool allowlists are native tool restrictions, not OS sandboxes
  around the whole adapter process. Managed policy remains authoritative.
- Cursor ask mode is native read-only behavior plus client-side deny-writes, not
  a tool allowlist. Repository rules (AGENTS.md, CLAUDE.md), project MCP, hooks,
  plugins and skills may remain visible; the `native-worker` pilot records an
  echoed instruction canary for Cursor as evidence rather than a failure.
  An ACP review session does not run project `sessionStart` hooks. The opt-in
  caller scenario uses a logged-in Cursor CLI print session in the disposable
  repository. It sets Cursor's `CURSOR_CONFIG_DIR` and `CURSOR_DATA_DIR` to
  disposable state, which redirects its CLI config, chats and project records;
  login stays in the existing native credential store. That session runs the
  project `sessionStart` hook, and the model must answer from the delivered
  context before it uses tools. The installation
  check only proves the hook command ran. It does not prove caller delivery.
- Native harnesses can write their own session/cache/auth state outside the
  reviewed source. Degreaser keeps its runtime store only in memory; it does not
  save full conversations, thoughts, environment dumps or raw tool payloads.
  Result processing must persist only validated review evidence.
- Max-turn enforcement is native where supported (Claude); other harnesses receive
  the instruction budget. The attempt deadline applies to startup and inference.
  Joining native cleanup may exceed that deadline.
- Unsupported session close is a disclosed limitation, not a lost valid result.
  Shutdown still runs and is awaited. Other cleanup failures remain failures.

The opt-in `native-worker` live scenario reads a random nonce from disposable code,
checks unchanged write and hook/context/MCP canaries, and checks joined lifecycle
events. Codex additionally exercises native OS write denial separately; it does
not claim the model attempted the denied write. Negative context canaries are not
proof that all ambient metadata is absent.

The same packaged native launchers also provide effective-profile observations:
Codex's native prompt diagnostics show read-only/never approval, native MCP
listing has no enabled servers, and feature listing confirms disabled
hooks/apps/delegation and enabled code-mode. A bounded native stdio
`config/read` check confirms effective `web_search: disabled` even over a
disposable user configuration requesting live search; it sends no model turn
and opens no listening port. Claude's actual initialization
advertises exactly Read/Grep/Glob, zero skills and zero MCP servers. Pi's native
system messages advertise exactly read/grep/find/ls. Read nonces and inactive
project hook/extension/instruction canaries accompany those checks.
Each profile also creates a second fresh actual session, cancels it during a
turn, and checks that observed owned native descendants have exited. Pi settings
are byte-compared before/after without copying credentials.

Deterministic fault fixtures are explicitly synthetic ACP servers exercising the
real public runtime. They are not recordings of provider failures. Live evidence
contains only selected identities, statuses, safe tool kinds and canary booleans.
The opt-in `review` scenario exercises compiled CLI/owner/report with one real
approved model and no minimum finding count. Native caller startup/waiting flows
remain separate integration work.
