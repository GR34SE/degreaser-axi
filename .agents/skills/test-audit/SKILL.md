---
name: test-audit
description: "Use when writing, changing, reviewing, or auditing automated tests in any project. Evaluate regression value, redundant coverage, implementation coupling, misleading mocks, and production code maintained only for tests."
---

# Test Audit

Protect useful confidence while reducing test maintenance. Apply these criteria
to the project's actual language, architecture, test framework, and workflow.
Do not assume a directory layout, package manager, CI provider, version-control
system, coding agent, or companion skill.

## Scope and local conventions

Read applicable project instructions and existing test configuration first.
Discover validation commands from project documentation, build configuration,
or CI; do not invent commands or introduce a new runner for the audit.

Match the requested scope:

- **Authoring:** apply the value bar to new or changed tests. Do not expand a
  feature or bug fix into an unrelated test cleanup.
- **Focused audit:** inspect the requested tests and the behavior they cover.
- **Broad audit:** inventory the requested component or project, divide it by
  actual responsibilities, and track reviewed and remaining areas. Work in
  coherent batches; do not optimize for deletion count.

A review request produces findings. Apply changes when the task authorizes
implementation or cleanup. A skill invocation does not itself authorize
commits, pushes, pull requests, deployment, or other external actions.

## Authoring gate

Before adding or changing a test, identify:

1. The observable behavior, invariant, or independent contract it protects.
2. A credible regression that would make it fail.
3. Why existing coverage would not already catch that regression.
4. The smallest stable boundary that exercises the real behavior.

Prefer extending a relevant existing test or parameterized case over copying
setup and assertions. Coverage at another layer needs a distinct failure mode,
such as serialization, persistence, integration, or lifecycle behavior.

Avoid exposing internals, adding flags, or inserting wrappers solely to assert
implementation details. First look for a real entry point. Dependency injection,
fakes, clocks, and other testability mechanisms are appropriate when they enable
meaningful deterministic checks without distorting the production design.

For bug fixes, demonstrate that the regression test fails before the fix for
the intended reason and passes afterward when feasible. Use an isolated copy
or another safe method that preserves concurrent work. If the baseline cannot
be run, report that limitation; do not claim the regression was reproduced.

## Suspicious patterns

Investigate these patterns; none alone proves that a test should be deleted:

- Tests that execute code without checking a meaningful outcome, including an
  outcome checked implicitly by the runner.
- Self-comparisons or expected values computed by the behavior under test.
- Fixtures or snapshots that copy implementation details without enforcing an
  independent contract.
- Source-text, import, private-method, or call-shape assertions that break under
  behavior-preserving refactoring.
- Repeated scenarios that add no distinct failure detection.
- Mocks that implement the behavior being asserted, hide integration differences,
  or provide the very state transition the production code should perform.
- Assertions against a fake or data store the exercised path never uses.
- Negative tests that pass because an unrelated validation or guard rejects
  the input before it reaches the intended behavior.
- Tests that restate configuration or capability declarations without checking
  the behavior those declarations promise.
- Test names that claim more than the inputs and assertions exercise.
- Production exports, switches, wrappers, or paths maintained only to support
  tests of otherwise unused implementation details.

## Retention bar

Keep tests that independently enforce meaningful contracts: user-visible
behavior, public interfaces, data integrity, compatibility, security,
accessibility, configuration, migrations, packaging, or performance requirements.

Also retain:

- Ordering and interaction checks when order or interaction is itself observable
  behavior or part of an external contract.
- Static checks, source inspection, snapshots, and exact-byte comparisons when
  they are the cheapest independent protection for a real requirement.
- Multiple test layers when they detect different credible failures.
- Regression tests with a credible failure mode not covered elsewhere.

Slow, static, mocked, or implementation-adjacent does not mean worthless.
Evaluate what the test can detect and what remains if it is removed. A failing
baseline may expose a product bug or an environment issue; investigate instead
of deleting the test to make the suite pass.

## Audit evidence

Before proposing removal, read the complete test, the implementation it exercises,
its relevant callers and dependencies, and overlapping coverage. Check history
and CI routing when available and relevant. For dependency-specific claims,
inspect the installed version's source, types, or authoritative documentation.

For each candidate, record concisely:

- Test name and location.
- The failure it actually detects.
- Stronger remaining coverage, or evidence that the behavior is obsolete.
- Production consumers of any code proposed for removal, including indirect
  consumers such as configuration, reflection, external APIs, or generated code.
- Why the test or supporting code exists, if known; state missing evidence.
- Proposed change, risk, and focused validation command.

If uncertainty could hide a real contract or consumer, keep the candidate and
report the gap. Absence of direct callers alone does not prove code is dead.

## Changes and validation

Choose the smallest coherent change that preserves useful coverage. Rewrite a
valuable but brittle test at a stable boundary. Remove redundant tests and
obsolete support code only when evidence supports removal and scope allows it.
Do not add abstractions or replacement tests just to maintain test count.

Use the project's existing validation workflow:

1. Establish the relevant baseline when feasible and distinguish pre-existing
   failures from failures introduced by the change.
2. Run the affected tests and relevant neighboring or integration checks.
3. When replacing a static assertion, exercise the actual contract it guarded.
4. Run formatting, static analysis, and broader checks required by the project
   or justified by the affected behavior.
5. Inspect the final diff for unrelated changes and unintended coverage loss.

Do not change files underneath an active validation run that reads them. If a
check cannot run, report the command, blocker, and resulting validation gap.
Do not imply that focused checks prove full-suite or production correctness.

## Handoff

Scale the report to the task. State what changed or was found, the evidence,
valuable tests retained, checks actually run, and unresolved risks. For broad
audits, include reviewed scope and remaining work. Include line counts or
repository delivery state only when relevant to the request.
