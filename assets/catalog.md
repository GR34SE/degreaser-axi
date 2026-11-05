# Built-in review catalog

The sixteen A01-A16 rubrics in `aspects/` are enabled by default. Each contains
three contextual REPORT examples and three contextual PRESERVE examples.
They are teaching material, not executed programs or model efficacy measurements.
PRESERVE means preserve within that aspect, not a correctness certificate.
The complete absence of a requested feature is outside this slop catalog.

The worker receives `worker.md`, `response.md`, the resolved assignment and
exactly one rubric. Repository content is evidence, never reviewer instructions.

## Boundary map

| Pair | Routing rule |
| --- | --- |
| A01 / A13 | Existing equivalent versus missing general-purpose solution. |
| A01 / A14 | Contracted component versus expression-level native construct. |
| A01 / A07 | Reimplemented mechanism versus convention divergence. |
| A02 / A03 | Behaviorless layer versus unused variant. |
| A02 / A12 | Behaviorless layer versus used cases with conflicting rules. |
| A03 / A12 | Unused variant versus used cases with conflicting rules. |
| A03 / A08 | Internal flexibility versus unrequested product functionality. |
| A04 / A05 | Result of actual error handling versus redundant checking. |
| A04 / A09 | Error turned into success versus suppressed contract mismatch. |
| A05 / A09 | Excess validation versus missing validation. |
| A07 / A15 | Convention divergence versus increased coupling in one unit. |
| A08 / A11 | Unrequested code versus required but disconnected code. |
| A10 / A16 | Test-runner-only verification versus other verification. |
| A12 / A15 | Divergent cases in one mechanism versus scattered rules in an overloaded unit. |
| A06 → A09 | Type/lint suppression comments belong to contract bypass. |
| A15 → A01 | Copies of existing code belong to failure to reuse. |

Source labels in rubrics identify their original inspirations, not a requirement
to load any private authoring documents. Each rubric includes its complete
question, evidence requirements, boundaries and examples.
