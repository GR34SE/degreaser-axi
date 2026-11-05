# Review results and local state

The response contract and `schemas/result-v1.json` are included in every
assignment before untrusted task/scope data and exactly one rubric. Only the last
assistant result block is accepted. Tool output and thoughts are not result text.
An unclosed or malformed last block does not fall back to an earlier block.

Quotes must occur literally within the inclusive `startLine`–`endLine` range
of the selected old/new Git blob. **Neighborhood tolerance is zero lines.**
Whitespace and line endings are not normalized. Old evidence uses the old path
(including rename sources); new evidence uses the new path. Excluded paths,
binaries and gitlinks cannot supply source quotes. Missing Git objects are
unavailable evidence, never an empty source file.

Each unsupported finding is rejected separately, with its one-based index and
reason available in `report --full`. Valid neighbors survive. If every finding
is rejected, the aspect becomes incomplete, not no-findings. This checks literal
support, not whether the recommendation is correct. The caller makes that decision.

Small patches are JSON-escaped inline. Patches over 60,000 encoded bytes are
stored as an escaped JSON string in `input/patch.json`; decoding produces the
identical Git patch. Scope and prompt hashes bind the assignment. Angle brackets
and ampersands in untrusted data cannot terminate the assignment delimiter.

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

## Stored JSON versions and failure handling

Schemas use JSON Schema draft-07, with no type coercion or unknown-field removal:

| File | Schema and version |
| --- | --- |
| Root `.degreaserrc.json` | `config-v1.json`; omitted `schemaVersion` means 1, explicit versions must be 1 |
| `.degreaser/state.json` | `state-v1.json`, requires `schemaVersion: 1`; latest-run pointer only |
| `runs/<id>/run.json` | `run-v1.json`, requires `schemaVersion: 1`; tasks, owner heartbeat, attempts and embedded results |
| `runs/<id>/input/review.json` | `input-v1.json`, requires `schemaVersion: 1`; immutable scope, task and selected execution identities |
| `runs/<id>/input/patch.json` | `patch-v1.json`; JSON string or null, version inherited from `input-v1`; must equal the input's patch |
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
persistence failures. Error messages do not include raw worker output.

`review` and `wait` return completed/0, partial or failed/1, or running/3.
`report` reads without launching work. `finding` retrieves complete evidence.
The default report shows at most 30 findings; `report --full` shows every finding,
per-aspect rejection reasons, attempts and exact selected identities.
Missing usage is unknown, not zero. No-findings and not-applicable are distinct;
neither a partial review nor an all-not-applicable review certifies clean code.

## Execution and lifecycle outcomes

All sixteen aspects run by default. The owner admits one worker at a time until
the first prompt has been accepted by the model transport, not merely until a
process or session is ready. It then fills all selected slots, or the explicitly
configured positive concurrency cap. A pre-invocation failure advances to the
next worker without releasing a still-cold fleet.

Only missing/malformed results and whole-attempt timeouts without valid evidence
receive up to `maxRetries` additional attempts. Each uses a fresh session, the
same assignment and exact model, and keeps its slot until cleanup finishes.
Valid incomplete results await explicit resume. Authentication, unavailable-model,
permission, account/quota/rate-limit and cleanup failures do not trigger blind
retries or fallback. Rate-limit reports name the same run and suggest explicit
resume with concurrency 1 after the selected account becomes available.

The original run deadline includes queued work and all attempts; errors never
reset it. Attempt limits include profile/adapter startup and inference. Cleanup
can outlast the deadline while owned processes are stopped and joined; no new
attempt starts during that join. Codex and Pi receive an advisory turn budget
and report that native max-turn enforcement is unavailable. Claude receives the
supported native limit.

Lifecycle disposition is separate from finding count:

- A valid denial-terminated result remains usable and can resolve the aspect.
  A denial without a valid result is an unresolved permission failure.
- Unsupported adapter close (including Pi) is normalized only after shutdown
  succeeds and is joined. The limitation is disclosed without losing evidence.
- A genuine close/shutdown failure is `cleanup`, never clean completion. Any
  schema-valid, quote-checked evidence is retained as `incomplete`, with the
  lifecycle cause in limitations and attempt history. No automatic retry follows.
- Valid evidence followed by timeout, cancellation or deadline also remains
  `incomplete`. It is useful but unresolved and requires explicit continuation.
  Without valid evidence, these stops cannot manufacture a no-findings result.

All selected aspects resolved means completed/0, even with findings or only
explained not-applicable results. Any useful result plus unresolved coverage is
partial/1, including all-incomplete results with zero findings. Zero useful
results is failed/1. Process exit 0 alone never establishes reviewed coverage.

This development slice has a per-run detached owner, exclusive ownership,
heartbeat, bounded attempts/deadline and same-ID waiting. Public cancellation,
continuation and full stale-owner recovery are still under development.
