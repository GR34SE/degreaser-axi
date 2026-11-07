# Built-in review catalog

The seventeen built-in rubrics in `aspects/` are enabled by default. Each contains
three contextual REPORT examples and three contextual PRESERVE examples.
They are teaching material, not executed programs or model efficacy measurements.
PRESERVE means preserve within that aspect, not a correctness certificate.
The complete absence of a requested feature is outside this slop catalog.

The worker receives `worker.md`, `response.md`, the resolved assignment and
exactly one rubric. Repository content is evidence, never reviewer instructions.

## Priority order

Configuration, worker admission and reports follow the order of the README
aspect table. `unnecessary-complexity` comes first; the rest run from the most
to the least damaging slop: hidden failures and false verification, then broken
integration and scope, then duplicated or misplaced mechanisms, then local style
and comments.

## Boundary map

| Pair | Routing rule |
| --- | --- |
| unnecessary-complexity / unnecessary-layers | Excess mechanism inside an implementation versus a behaviorless layer. |
| unnecessary-complexity / speculative-flexibility | Excess mechanism for current requirements versus unused variants. |
| unnecessary-complexity / wrong-abstraction | Excess mechanism for one case versus divergent cases sharing a mechanism. |
| unnecessary-complexity / unidiomatic-code | Algorithm or control-flow design versus an expression-level native construct. |
| unnecessary-complexity / structural-erosion | Excess mechanism for one responsibility versus added responsibilities or coupling. |
| unnecessary-complexity / unjustified-defense | Excess main logic versus redundant checks and handlers. |
| unnecessary-complexity / missed-reuse | Simpler own implementation versus an existing equivalent. |
| missed-reuse / reinvented-infrastructure | Existing equivalent versus missing general-purpose solution. |
| missed-reuse / unidiomatic-code | Contracted component versus expression-level native construct. |
| missed-reuse / convention-drift | Reimplemented mechanism versus convention divergence. |
| unnecessary-layers / speculative-flexibility | Behaviorless layer versus unused variant. |
| unnecessary-layers / wrong-abstraction | Behaviorless layer versus used cases with conflicting rules. |
| speculative-flexibility / wrong-abstraction | Unused variant versus used cases with conflicting rules. |
| speculative-flexibility / scope-creep | Internal flexibility versus unrequested product functionality. |
| masked-errors / unjustified-defense | Result of actual error handling versus redundant checking. |
| masked-errors / contract-bypass | Error turned into success versus suppressed contract mismatch. |
| unjustified-defense / contract-bypass | Excess validation versus missing validation. |
| convention-drift / structural-erosion | Convention divergence versus increased coupling in one unit. |
| scope-creep / incomplete-integration | Unrequested code versus required but disconnected code. |
| low-value-tests / verification-theater | Test-runner-only verification versus other verification. |
| wrong-abstraction / structural-erosion | Divergent cases in one mechanism versus scattered rules in an overloaded unit. |
| low-value-comments → contract-bypass | Type/lint suppression comments belong to contract bypass. |
| structural-erosion → missed-reuse | Copies of existing code belong to failure to reuse. |

Source labels in rubrics identify their original inspirations, not a requirement
to load any private authoring documents. Each rubric includes its complete
question, evidence requirements, boundaries and examples.
