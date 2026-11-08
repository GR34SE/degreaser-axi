# Unnecessary complexity

`unnecessary-complexity` · default ON

**Question:** Is this the simplest implementation possible?

**Applies when:** The change adds or rewrites implementation logic: functions, methods, algorithms, control flow, state or data transformations. Changes limited to documentation, configuration values, generated data or formatting are not-applicable.

**Evidence:** Name the extra mechanism, such as manual state, phases, flags, intermediate collections, extra passes, recursion, callbacks or concurrency. Describe the concrete simpler implementation and show that it keeps every actual requirement: results, ordering, errors, side effects, concurrency, resource limits and public contracts. Name the cost the extra mechanism adds, such as state to keep consistent, impossible combinations or more paths to test.

**Boundaries:** Simplest means the least mechanism that meets the actual requirements and contracts, not the fewest lines, files or branches. Preserve complexity required by the domain, a documented contract, a measured constraint or an established repository convention. Do not propose a rewrite that drops a requirement or moves the same complexity elsewhere, and do not report a preference between equivalent forms.

**Not here (another reviewer):**
- An intermediate wrapper, service, factory or interface without behavior: unnecessary-layers.
- An option, parameter, flag or extension point without a current consumer: speculative-flexibility.
- A shared mechanism combining cases with divergent rules: wrong-abstraction.
- A single expression or loop replaceable by a language or standard-library construct such as map, Set or join: unidiomatic-code.
- New responsibilities, dependencies or coupling added to an existing unit: structural-erosion.
- A redundant validation, guard or error handler for a state that cannot occur: unjustified-defense.
- A mechanism the repository, an installed dependency or the platform already provides: missed-reuse.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## unnecessary-complexity-B1 · REPORT

**Context:** The function runs three steps once, in this order, within one call. Nothing persists, resumes or retries the steps, and no caller observes the phase.

```typescript
let phase: "load" | "validate" | "save" | "done" = "load";
let data: Input | undefined;
while (phase !== "done") {
  switch (phase) {
    case "load": data = await load(id); phase = "validate"; break;
    case "validate": validate(data!); phase = "save"; break;
    case "save": await save(data!); phase = "done"; break;
  }
}
```

**Why:** The loop, phase variable and non-null assertions encode a straight sequence. `const data = await load(id); validate(data); await save(data);` keeps the order and error propagation while removing states and assertions that every reader must trace.

## unnecessary-complexity-B2 · REPORT

**Context:** A cart holds at most 20 items. count and total are read only to render the cart summary, and no measurement or contract requires caching them.

```python
class Cart:
    def __init__(self):
        self.items, self.count, self.total = [], 0, 0

    def add(self, item):
        self.items.append(item)
        self.count += 1
        self.total += item.price

    def remove(self, item):
        self.items.remove(item)
        self.count -= 1
        self.total -= item.price
```

**Why:** count and total duplicate information already in items, so every mutator must keep three fields consistent. Deriving len(self.items) and the sum of prices when they are read keeps the results for a bounded cart and removes the synchronization duty.

## unnecessary-complexity-B3 · REPORT

**Context:** The function must report whether any order is overdue. Order IDs are unique, the result is one boolean and iteration order does not affect it.

```go
byID := make(map[string]Order, len(orders))
for _, o := range orders {
    byID[o.ID] = o
}
ids := make([]string, 0, len(byID))
for id := range byID {
    ids = append(ids, id)
}
sort.Strings(ids)
for _, id := range ids {
    if byID[id].Due.Before(now) {
        return true
    }
}
return false
```

**Why:** The map and sorted key list serve no requirement. One loop over orders that returns on the first overdue order gives the same boolean without two intermediate collections, a sort and a second lookup. The loop itself is idiomatic Go; the excess is the pipeline around it.

## unnecessary-complexity-G1 · PRESERVE

**Context:** An import job can be interrupted by a deploy. A restarted worker reads the persisted phase and must continue without repeating a completed download or a publish.

```typescript
switch (job.phase) {
  case "download": await download(job); return saveJob({ ...job, phase: "parse" });
  case "parse": await parse(job); return saveJob({ ...job, phase: "publish" });
  case "publish": await publish(job); return saveJob({ ...job, phase: "done" });
}
```

**Why:** The persisted phase is the resumption contract. A straight sequence would repeat side effects after a restart. Similar shape to a needless state machine does not make this one needless.

## unnecessary-complexity-G2 · PRESERVE

**Context:** The ledger is append-only and holds millions of entries. Profiling showed that summing entries on every balance request dominated request latency, and the latency target is documented.

```python
def append(self, entry):
    self.entries.append(entry)
    self.balance += entry.amount
```

**Why:** The maintained balance is the simplest mechanism that meets the measured constraint, and append-only storage leaves one place to update it. Derived state is not excess when a measured requirement needs it.

## unnecessary-complexity-G3 · PRESERVE

**Context:** The scheduling module must follow Gregorian calendar rules for any year it accepts.

```typescript
function isLeapYear(year: number) {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}
```

**Why:** Each branch states a calendar rule. A shorter year % 4 === 0 would treat 1900 and 2100 as leap years. Fewer branches are simpler only when the behavior stays the same.
