# Misleading and redundant tests

`low-value-tests` · default ON

**Question:** Can the test detect a plausible regression not already detected by a stronger retained test?

**Applies when:** The change adds or edits tests, test helpers, fixtures or mocks. Otherwise return not-applicable.

**Evidence:** Name a plausible regression, the actual code executed and the source of expectations. For redundancy, identify a stronger retained test under the same conditions.

**Boundaries:** Neither unit nor smoke tests are prohibited categories. A mock or fake does not invalidate a test unless it implements the rule instead of the code under test. Without execution, describe source analysis, not a demonstrated mutation-test result.

**Not here (another reviewer):**
- Verification outside a test runner, including runtime code, CI, scripts and check/verify commands: verification-theater.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## low-value-tests-B1 · REPORT

**Context:** The test is meant to protect production discount calculation but executes a local fake instead.

```typescript
const discount = () => 90;
assert.equal(discount(), 90);
```

**Why:** The test never exercises the rule it claims to protect. Production discount logic can break without affecting this test.

## low-value-tests-B2 · REPORT

**Context:** The expected amount should follow the billing contract; the test reproduces the production formula to calculate it.

```typescript
const expected = order.net * TAX_RATE; // same formula as calculateTax
assert.strictEqual(calculateTax(order), expected);
```

**Why:** The expectation copies the production formula, so a shared mistake such as a wrong rate or missing rounding remains invisible. Independent verification needs values from the billing contract.

## low-value-tests-B3 · REPORT

**Context:** Under the same configuration, an existing test checks the complete result. A new smoke test executes the identical path with only a weaker assertion.

```python
def test_export_smoke():
    assert run_export(SAMPLE_INPUT) is not None
```

**Why:** Given that coverage, the new test detects no additional regression. Before removal, identify the stronger retained test and confirm identical conditions.

## low-value-tests-G1 · PRESERVE

**Context:** The domain contract requires converting amounts in this format to integer cents. The test imports assert from node:assert/strict.

```typescript
assert.equal(parseAmount("0.10"), 10);
assert.equal(parseAmount("12.34"), 1234);
```

**Why:** Expectations come from an independent contract and can detect a scaling error. This unit test has value.

## low-value-tests-G2 · PRESERVE

**Context:** The test installs the current commit's npm pack tarball into an empty directory. Module tests do not cover manifest bin/files fields or missing packaged files.

```typescript
const result = runInstalledPackage("--version");
assert.equal(result.exitCode, 0);
assert.match(result.stdout, VERSION_PATTERN);
```

**Why:** The smoke test protects a distinct packaging and launch boundary. Its small size does not imply redundancy.

## low-value-tests-G3 · PRESERVE

**Context:** The rule requires publishing an event only after durable order storage. A fake repository and publisher append their calls to a shared log.

```python
service.place_order(order)
assert log == [("commit", order.id), ("publish", order.id)]
```

**Why:** The test runs the real service and checks required ordering. A mock or fake is valid when it does not implement the tested rule on the service's behalf.
