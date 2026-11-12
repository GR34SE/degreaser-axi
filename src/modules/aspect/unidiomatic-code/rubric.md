# Language and platform idioms

`unidiomatic-code` · default ON

**Question:** Can a language or standard-library construct replace the manual implementation without changing semantics, or eliminate unnecessary cost?

**Applies when:** The change adds expression-level manual logic: loops, accumulators, collection or string operations with a direct language or standard-library equivalent. Otherwise return not-applicable.

**Evidence:** Establish equivalence in ordering, equality, sparse collections, exceptions, mutation, asynchronous behavior and early termination. Verify that the native API exists at the project's minimum supported runtime. Check repository conventions and idioms of the language under review; shorter syntax is not proof of equal behavior.

**Boundaries:** A loop alone is not evidence of slop. Idioms do not transfer automatically between languages; for example, for loops are idiomatic Go. Stylistic preferences without concrete cost are not findings.

**Not here (another reviewer):**
- Excess algorithm or control-flow design beyond one expression, such as manual phases, duplicated state or extra passes: unnecessary-complexity.
- An existing repository, dependency or framework component with its own contract: missed-reuse.
- Custom general-purpose infrastructure such as a standard parser or evicting cache: reinvented-infrastructure.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## unidiomatic-code-B1 · REPORT

**Context:** A pure transformation of a dense array preserves order, never terminates early and needs neither mutation nor a special allocation budget. The module uses map for such operations.

```typescript
const names: string[] = [];
users.forEach(user => { names.push(user.name); });
```

**Why:** A separate mutated accumulator obscures a simple transformation. Here map preserves semantics and convention; this is not a general ban on loops.

## unidiomatic-code-B2 · REPORT

**Context:** The operation must remove identical strings while preserving first occurrence; performance matters for a large list.

```typescript
const unique: string[] = [];
for (const item of items) {
  if (unique.indexOf(item) === -1) unique.push(item);
}
```

**Why:** Linear search for every element adds unnecessary cost. Standard Set preserves the required order and string equality.

## unidiomatic-code-B3 · REPORT

**Context:** The task is ordinary string joining with a separator and no special end-of-list behavior.

```python
result = ""
for index, part in enumerate(parts):
    if index > 0:
        result += ","
    result += part
```

**Why:** Manual separator management adds state and branching to an operation covered by join. The contract requires no additional behavior.

## unidiomatic-code-G1 · PRESERVE

**Context:** Every write depends on the previous one; access to the same resource must be sequential.

```typescript
for (const update of updates) {
  await applyUpdate(update);
}
```

**Why:** The loop expresses required ordering. Replacing it with map and Promise.all would change the contract.

## unidiomatic-code-G2 · PRESERVE

**Context:** isMatch is asynchronous and expensive, for example querying a service. Candidates must be checked sequentially only until the first match.

```typescript
for (const candidate of candidates) {
  if (await isMatch(candidate)) return candidate;
}
```

**Why:** candidates.find(async c => …) would return the first element because a Promise is truthy, while Promise.all would lose sequencing and early termination. The loop preserves the required semantics. Collection methods alone do not justify a finding.

## unidiomatic-code-G3 · PRESERVE

**Context:** Profiling the hot path identified GC pressure from values.map(transform). Results go into a reused Float64Array buffer consumed after each frame.

```typescript
for (let i = 0; i < values.length; i++) {
  out[i] = transform(values[i]);
}
```

**Why:** map would allocate a new array every frame, while buffer reuse is required. The criteria are the contract and measurement, not preferred syntax.
