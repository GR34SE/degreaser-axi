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

The initial storage format keeps each run's task statuses, attempts and validated
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

`review` and `wait` return completed/0, partial or failed/1, or running/3.
`report` reads without launching work. `finding` retrieves complete evidence.
The default report shows at most 30 findings; `report --full` shows every finding,
per-aspect rejection reasons, attempts and exact selected identities.
Missing usage is unknown, not zero. No-findings and not-applicable are distinct;
neither a partial review nor an all-not-applicable review certifies clean code.

This development slice has a per-run detached owner, exclusive ownership,
heartbeat, bounded attempts/deadline and same-ID waiting. Public cancellation,
continuation and full stale-owner recovery are still under development.
