# Review results and local state

The finder and verifier response contracts, each with its JSON schema, are included in
every assignment of that stage before untrusted task/scope data and exactly one rubric. Only the last
assistant result block is accepted. Tool output and thoughts are not result text.
An unclosed or malformed last block does not fall back to an earlier block.

Quotes must occur literally within the inclusive `startLine`–`endLine` range
of the selected old/new Git blob. **Neighborhood tolerance is zero lines**,
apart from the single end-line correction in the next paragraph.
Only CRLF line endings and trailing whitespace per line are normalized. A quote
copied from the patch is accepted when every non-empty line carries one diff
marker consistent with the cited side (`+`/space for new, `-`/space for old);
the marker-stripped text must still occur in the cited lines. Likewise, a quote
copied from numbered audit text, with a `<digits><tab>` prefix on every non-empty
line, is checked without those prefixes. A quote needs at
least three non-whitespace characters unless it equals the whole cited text.
Absolute or `./`-prefixed finding paths inside the repository are normalized
before schema validation; other paths remain invalid. Old evidence uses the old path
(including rename sources); new evidence uses the new path. Excluded paths,
binaries and gitlinks cannot supply source quotes. Missing Git objects are
unavailable evidence, never an empty source file. A symbolic link (mode `120000`) is cited at its own path as line 1 of its target text; quotes validate against that blob, not the target.

The one exception to the cited range is an end line that omits exactly the
quote's final line. It is corrected only when the cited start line is already
exact and the complete quote matches whole source lines uniquely in that same
blob. This correction is stricter than the matching above: it requires at
least two nonempty lines and three non-whitespace characters, does not strip
diff markers or trailing whitespace, and normalizes only CRLF line endings and
one terminal newline. The saved finding reports the verified end line.
Ambiguous quotes, shifted starts and larger range errors remain rejected.

Wire forms: the final block must be one well-formed JSON object whose schema
fields are exactly the documented ones. Before source validation, the only
canonicalization is omitting a
top-level `reason` that is null, empty or whitespace-only when the status does
not require one; the persisted result is the strictly validated canonical form.
A missing or empty `reason` for `not-applicable`, malformed JSON, a different
aspect, unknown fields and every other schema violation remain `invalid-output`.
A rejected attempt is retried (within `maxRetries`, same model) with the
validator's short message appended to the prompt; the raw payload is not echoed.

Each unsupported candidate is rejected separately, with its one-based index and
reason available in `report --full`. Valid neighbors survive, but the path of a
rejected candidate stays uncovered, so the aspect stays incomplete and resume
reruns that path. If every candidate
of a shard is rejected, that shard fails, so the aspect becomes incomplete, not
no-findings. This checks literal support, not whether the recommendation is
correct. The caller makes that decision.

## Two stages: finders and verifiers

Each aspect runs in two worker stages, each in fresh sessions with its own
identity (see [input-contract.md](input-contract.md)).

**Find.** The coordinator packs the assessed paths into shards of bounded text
size; a path larger than a shard is a shard of its own. One finder session per
shard receives the shard's content inline (patch sections for a change scope,
numbered file text for a repository audit; quotes exclude the line numbers).
Binary, symbolic-link, gitlink and oversized paths are listed for tool reading.
The finder also receives the patch file reference and the number of other
assessed paths as context, but reports only on its shard. It enumerates
candidates and does not adjudicate: each
candidate has a location, an exact quote and a one-line title, every instance is
listed separately, and a doubtful one is still listed. When the rubric declares a
`Unit` ([aspects.md](aspects.md)), the finder also returns a `kept` inventory,
the location and quote of every unit it examined and did not report. A finder
status is `findings`, `no-findings`, `not-applicable` or `incomplete`. Exact
duplicates across shards are kept once.

**Verify.** The candidates of each finder shard, ordered by path and line, are
sent in numbered batches of at most 20, which may span several paths, to a
separate verifier session. The verifier receives the task, the rubric with its
examples and the batch, never the finder's reasoning, and tries to refute each
candidate. A verdict is `upheld`, with the action to take, or `refuted`, with a
reason and optional quoted evidence. Evidence quotes are checked like any other
quote; a verdict whose evidence quote fails is dropped. A candidate that has no
valid verdict is `unverified`. Verdicts from a verifier session that did not
finish cleanly (timeout, cleanup failure, cancellation or deadline) are not
applied, so its candidates stay `unverified`. Verdicts are source judgments, not
test or runtime evidence.

A stored finding therefore has a location, quote and title, a `verdict` of
`upheld`, `refuted` or `unverified`, and, once verified, the action or reason and
evidence.

**Coverage** is assigned by the coordinator: the paths of a shard count as
examined when its finder returned a valid result whose status is not `incomplete`.
Workers do not declare examined paths and cannot leave open entries. Binaries
and gitlinks are not required. `scope-creep` not-applicable is the exception: its
rubric decides applicability from the task's feature scope, not from files.
Report coverage shows `examined` as examined/assessed paths, with
`coverageBasis: coordinator-assigned`. It records that a finder returned a valid
answer for the shard, not proof that every line was read. Each unresolved task
records its `unresolved.cause` and the exact pending `paths`, and report coverage
shows `stopCause` and `pending`. Causes include `deadline`, `cancelled`, `timeout`,
`invalid-output` and other runtime failure codes.

**Aspect status.**

1. Any uncovered path, failed shard or `unverified` finding: `incomplete`.
2. Otherwise at least one `upheld` finding: `findings`.
3. Otherwise every shard `not-applicable`: `not-applicable`.
4. Otherwise `no-findings`, including when every candidate was refuted.

Established findings are kept when an aspect is incomplete.

Assignment evidence is TOON inside a tag whose suffix is derived from the
evidence digest, so embedded text cannot close the block. A change scope also
writes the raw unified diff to `input/patch.diff`, and each assessed path carries
`patchLines`, its section's line range there, so workers can read the change in
slices. `input/patch.json` keeps the exact patch as a JSON string for resume
integrity. The prompt hash binds both stages' instructions, response contracts and
schemas plus the rubric; it does not include shard content.

The storage format keeps each run's task statuses, attempts and validated
results together in one atomically replaced `run.json`. The separately immutable
`input/review.json` and `input/patch.json` retain the resolved input. `state.json`
selects the latest run. JSON schemas are checked on read and write. Unknown or
corrupt state is not silently discarded. State directories cannot be symlinked.
New directories/files use modes 0700/0600. Review requires `.degreaser/` to be
ignored; it does not modify the index or install integrations.

Artifacts intentionally include source patches, task text and finding quotes.
They can contain sensitive project data. Keep `.degreaser/` local and ignored.
No full worker conversations, thoughts, raw tool payloads or native credentials
are stored by Degreaser. Native harness session/cache behavior is separate.

Diagnostics use fixed failure categories and repair guidance. Native version
output is restricted to bounded numeric major/minor/patch tokens; other text
is reported as unrecognized. Configuration errors identify schema constraints,
not unknown input keys or values. Unexpected local exceptions do not expose their
messages or stacks. Selected model IDs and local paths remain visible, so never
use them to carry credentials. This is not a general secret scanner: validated
result text and source evidence are intentionally retained, not scrubbed.

## Stored JSON versions and failure handling

Schemas use JSON Schema draft-07, with no type coercion or unknown-field removal:

| File | Schema and version |
| --- | --- |
| Root `.degreaserrc.json` | `config-v1.json`; omitted `schemaVersion` means 1, explicit versions must be 1 |
| `.degreaser/state.json` | `state-v1.json`, requires `schemaVersion: 1`; latest-run pointer only |
| `runs/<id>/run.json` | `run-v1.json`, requires `schemaVersion: 1`; tasks, owner heartbeat, attempts and embedded results |
| `runs/<id>/input/review.json` | `input-v1.json`, requires `schemaVersion: 1`; immutable scope, task and selected execution identities |
| `runs/<id>/input/patch.json` | `patch-v1.json`; JSON string or null, version inherited from `input-v1`; must equal the input's patch |
| `runs/<id>/input/patch.diff` | Raw copy of the same patch for worker slice reads; absent when the patch is null; not read back by the coordinator |
| Embedded aspect result | `result-v1.json`, referenced by `run-v1`; no separate file or version field |

Malformed JSON, invalid structure, unsupported versions and inconsistent
run/result identities fail with the affected filename. Reads do not recover
from Markdown, temporary files or an empty result. A new review checks the
latest history before model discovery; explicit run reads need not consult the
latest-run pointer. No command repairs damaged history by overwriting it.

Every state write validates first. The owner also validates an existing
`run.json` before replacing it, so damage discovered during a run stops writes.
Replacement writes a unique, mode-0600 temporary file in the same directory,
flushes its contents, then renames it over the destination. Readers see the
previous complete record or the next complete record, never a partial one.
The latest-run pointer is published last. This is not a cross-file transaction
or a guarantee against every filesystem/power-loss failure.

If a write fails, the owner stops admission, joins its workers and makes no
further state writes. Previously committed results and attempts remain intact.
Owner loss leaves the last committed progress visible as interrupted, without
inventing an attempt ending or a result. A process killed before rename can leave
an ignored `.tmp` file; it is not authoritative and is never used for recovery.
Prompt-identity changes and unexpected owner-task errors remain distinct from
persistence failures. With writable storage, the owner joins active work, saves
the sanitized fatal code/message in its `executions` entry and publishes
partial/failed coverage. Short reports show the latest execution failure; full
reports retain earlier failures after resume. Error messages do not include raw
worker output, exception payloads or stacks. No second error store is used when
the authoritative store fails.

`review` and `wait` return completed/0, partial or failed/1, or running/3.
`report` reads without launching work. `finding` retrieves complete evidence.
The default report lists every upheld finding grouped by path, one compact row each
with its ID, aspect, lines and action, with no item cap. Its summary counts upheld,
refuted and unverified findings. `report --full` also shows refuted and unverified
findings with their reasons and evidence, per-aspect rejection reasons, attempts and
exact selected identities; `finding <id>` shows the same for one finding.
An unverified finding makes its aspect incomplete, so the run is partial and exits 1. It reports
the reviewed path count as `paths`; `pathList` names the run's resolved input
(`.degreaser/runs/<run-id>/input/review.json`) that holds the complete list.
Missing usage is unknown, not zero. No-findings and not-applicable are distinct;
neither a partial review nor an all-not-applicable review certifies clean code.

## Finding order and read surfaces

For the same saved finding set, IDs and order do not depend on worker completion,
result-list order or verdicts. Findings sort by path, start line, side (`new`
before `old`), end line, aspect, title and quote, and receive `F<n>` in that
order. Text comparisons use case-sensitive UTF-16 order, not locale collation.
Identical findings remain separate, and equal recommendations never merge
findings. Because a verdict does not move a finding, an ID stays the same when a
resume verifies a previously unverified finding. The default report lists only
upheld findings with their IDs, so gaps in the numbering are expected. New
candidates from a resumed finder can shift later IDs.

Short reports expose the counts of upheld, refuted and unverified findings,
resolved/selected `aspects`, and each aspect's status, reason (omitted when none), limitations and
rejection count. Reasons and aspect limitations longer than 240 characters show
a preview, original length and a full-report command. Run-level `limitations`
lists input and shared harness limitations once; aspect rows own the remaining
worker-reported and attempt limitations, excluding text identical to their reason.
`report <run-id> --full` retrieves every finding without clipping, and `finding <id> --run <run-id>` includes its aspect's limitations
and the input's coverage limits. Running reports read the current saved snapshot
without waiting; omitted rows still have a full-report command.

Full reports distinguish `configuration` (all selected exact identities),
`coordinator` (applicability results without workers), and `execution` (only
tasks with actual attempt records). Repository scope-creep stays configured but appears
as coordinator-owned not-applicable, never a phantom worker.

Every worker call is an attempt tagged with its `stage` (`find` or `verify`) and, for
a finder shard or verifier batch, a `portion: {index}` naming which slice it
covered. Retries of one call share its portion. Limitations and reasons from every
shard and batch are kept, prefixed with their portion where they may describe only
part of the paths.

`usageScope: all-attempts-per-aspect` means usage sums every recorded attempt of
an aspect: both stages, every shard and batch, and all retries. The summary `usage` is the total over
all executed aspects; `report --full` adds `aspectUsage` (one row per aspect,
or `unknown` with the total) and each execution row's `usage`. A sum is known
only when every attempt in it has nonempty metadata, so an attempt that failed
before reporting usage makes its aspect and the total `unknown`, never a partial
sum presented as a total. Only fields present in every summed attempt are added. Missing
fields are not estimated or filled with zeros. A coordinator-only run has
unknown usage, not an invented zero.

Stored task `usage` resets to null when a new attempt is admitted, including
retries and resume, then receives the same sum over all of the task's attempts.
Reports use the attempt records, not that task summary. Earlier `attempts[].usage` records and
successful peers remain unchanged, and `report --full` preserves known usage at
its original position in attempt history. Usage is what workers reported, not
complete billing coverage.

No ID selects the latest run in the current repository; an explicit ID selects
that repository's historical run without relying on the latest pointer.
`no-history`, `run-not-found`, `finding-not-found` and `state-corrupt` are distinct
read failures (exit 2). Damage names its file and never falls back to another run.
Home reads configuration and history independently, even if the current RC is
absent or invalid. Home, doctor, report and finding do not install, repair or
start reviews/models. Doctor only probes local native capability; it does not
establish account access or model availability.

## Execution and lifecycle outcomes

All eighteen aspects run by default and start together. A run-wide limit caps
simultaneous workers across both stages: `concurrency`, 16 when absent, or no cap
when `null`. The owner admits one worker at a time until
the first prompt has been accepted by the model transport, not merely until a
process or session is ready. It then fills the available slots. A pre-invocation failure advances to the
next worker without releasing a still-cold fleet.

Only missing/malformed results and whole-attempt timeouts without valid evidence
receive up to `maxRetries` additional attempts. Each uses a fresh session, the
same assignment and exact model, and keeps its slot until cleanup finishes.
Assistant output over 1,048,576 JavaScript string characters is discarded in
full, including any earlier valid block. This bounded `output-limit` failure
gets the same retry budget as missing/malformed output, never a larger buffer
or unlimited retries. Output exactly at the limit remains eligible for validation.
Valid incomplete results await explicit resume. Authentication, unavailable-model,
permission, account/quota/rate-limit and cleanup failures do not trigger blind
retries or fallback. Rate-limit reports name the same run and suggest explicit
resume with concurrency 1 after the selected account becomes available.
Disabled or suspended accounts are `account-disabled`, not transient quota:
restore access to the selected account with its provider before resuming.
Assistant text that is only `Add a payment method to continue`, with no result
block, is the same account failure. It is not invalid output and it is not
retried.
Waiting or lowering concurrency does not restore account access. Classification
prefers explicit machine codes and HTTP status metadata, with constrained
message fallback; a bare number 429 in unrelated prose is not a rate limit.

The original run deadline includes queued work and all attempts; errors never
reset it. Attempt limits include profile/adapter startup and inference. Cleanup
can outlast the deadline while owned processes are stopped and joined; no new
attempt starts during that join. Codex, Pi and Cursor receive an advisory turn budget
and report that native max-turn enforcement is unavailable. Claude receives the
supported native limit.

Lifecycle disposition is separate from finding count:

- A valid denial-terminated result remains usable and can resolve the aspect.
  A denial without a valid result is an unresolved permission failure.
- Unsupported adapter close (including Pi) is normalized only after shutdown
  succeeds and is joined. The limitation is disclosed without losing evidence.
- A genuine close/shutdown failure is `cleanup` when no earlier failure exists,
  never clean completion. An earlier attempt cause remains in history alongside
  an explicit cleanup-failed limitation. Any
  schema-valid, quote-checked evidence is retained as `incomplete`, with the
  lifecycle cause in limitations and attempt history. No automatic retry follows.
- Valid evidence followed by timeout, cancellation or deadline also remains
  `incomplete`. It is useful but unresolved and requires explicit continuation.
  Without valid evidence, these stops cannot manufacture a no-findings result.
- An observed attempt failure is not overwritten by a later run stop or by the
  transport errors caused by stopping it. Each execution records its separate
  `stopReason` (`cancelled` or `deadline`); short reports show the latest stop
  and full reports retain earlier stops after resume. Cleanup is still joined,
  admission/retries stop, and useful peer results remain intact.

All selected aspects resolved means completed/0, even with upheld findings or only
explained not-applicable results. An unverified finding leaves its aspect incomplete,
so it makes the run partial/1. Any useful result plus unresolved coverage is
partial/1, including all-incomplete results with zero findings. Zero useful
results is failed/1. Process exit 0 alone never establishes reviewed coverage.

## Exclusive continuation

`resume <run-id>` checks live source, the stored task-file when supplied, resolved
base, assembled instruction/response/rubrics and selected aspect agent/model.
Changed review input is refused without rewriting prior evidence.
Git/configuration/state errors retain their diagnostics rather than implying an
identity mismatch. Task/prompt read failures return `environment-blocked` with
access-repair guidance. No replacement work starts when freshness cannot be checked.
Wait, concurrency and deadline are execution controls, not review identity. Input and
patch artifacts stay unchanged; `run.json` records each owner's start, effective
concurrency, wait and absolute deadline. Only explicit `--deadline <seconds>`
starts a new budget. Expired original budgets are not silently renewed.

Resolved findings/no-findings/not-applicable tasks are never replayed. Pending,
interrupted, failed, cancelled and incomplete tasks get fresh attempts, but only
for the work that is still open: finder shards over the uncovered paths and
verifier batches for `unverified` findings. Candidates, upheld and refuted
verdicts and covered paths are kept, and a verdict is never replayed. Attempt records retain earlier
validated evidence, rejection reasons, limitations, session identities and known
usage. A failed replacement does not erase the previous incomplete evidence.
Full reports expose this history. A completed unchanged resume is a no-op.

Only the owner writes progress. A short-lived exclusive `admission.lock`
serializes owner replacement; `owner.lock` identifies the active owner.
Cancel uses that same short admission lock before reading/signalling the current
owner or accepting a terminal no-op. Contention refuses with exit 2 and explicit
"cancellation was not applied" guidance to retry cancel after admission, not an
old terminal report. A live owner's ordinary lock does not block cancellation.
Cancelling an interrupted run performs the same verified cleanup of old workers
as resume, without starting work.
Heartbeat age alone never authorizes eviction. After confirmed death, recovery
checks recorded OS birth identities and process groups before stopping old
workers, and waits for cleanup before admitting replacements. Process identities
are local PID/start/group metadata, not command transcripts or environment values.
Unverified PIDs or ambiguous locks refuse recovery without signalling strangers.
Use the original Node executable and inspect saved PID/start/group identities.
Known reused-owner reports provide inspection guidance instead of a guaranteed
refused resume. When identity remains unverifiable, preserve history and start
a new review only after confirming old work has stopped.
If a process dies during the short admission critical section, its admission lock
requires explicit local inspection before removal; it is never stolen on age alone.
These checks do not supervise deliberately escaped, unobservable daemons.

Earlier development runs with the old whole-input fingerprint remain readable.
They require a new review rather than automatic continuation: those inputs did
not record whether their task came from a file, so freshness cannot be fully
rechecked. Their saved evidence is not migrated or overwritten.

Worker-marked callers cannot review or resume; ordinary wait/cancel remain
available. Killed callers do not own the detached run. Killed owners produce
interrupted/1 and same-run resume guidance, retaining committed evidence.

## Report example

A representative one-aspect report excerpt:

```text
status: completed
evidence: source-only
scope: worktree
aspects: 1/1
upheld: 1
refuted: 0
unverified: 0
rejected: 0
findings:
  sum.ts[1]{id,aspect,lines,action}:
    F1,low-value-comments,"new:1-1",Remove it.
coverageBasis: coordinator-assigned
```

For example, `finding F1` can quote `// Return the sum of two numbers.`, show the verifier's action and explain why the comment repeats the function below it. The quote check establishes that the code exists, not that the recommendation is correct. Zero findings is equally valid.
