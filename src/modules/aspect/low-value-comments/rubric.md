# Low-value comments

`low-value-comments` · default ON

**Question:** Does this comment prevent a concrete maintenance or usage trap that cannot be derived from the code?

**Applies when:** The assessed change contains added or edited explanatory comments or docstrings. In a repository audit, assess existing comments too. Otherwise return not-applicable.

**Rule:** Zero explanatory comments by default. Keep only the minimum warning needed to prevent a specific, non-obvious mistake whose cause is not recoverable from names, types, implementation or connected callers. Explaining what code does, why a developer likes it, or how an algorithm works does not meet this bar. Correctness, brevity and usefulness as a summary do not justify a comment. Extra narration creates a second, drifting description that developers and coding agents can mistake for authority.

**Evidence:** Apply the trap test to every assessed explanatory comment, including one-line summaries on functions, fields and constants, not just long or inaccurate comments. Quote the comment and its code, then inspect the relevant implementation and callers. For preservation, identify the tempting wrong change or use, its concrete consequence, and the hidden fact the comment supplies. Check that fact against available source or an established external contract; the comment's own claim is not proof. If no such trap remains after that check, report the comment for removal and show which information is recoverable or irrelevant. Redundant narration is the defect; it need not cause a runtime bug. Group repeated instances and list their locations rather than silently ignoring short ones. Do not invent a trap to justify a comment or claim an external fact is false merely because its source is unavailable; state that uncertainty.

**Boundaries:** Exported symbols, public APIs, JSDoc form, security vocabulary, complicated code and documentation conventions are not exemptions. A visible thrown error or unit conversion is still visible code. Prefer clearer names, types or simpler code when they can remove the need for an explanation; do not invent an abstraction just to remove a comment. A real warning buried in narration must be reduced to that warning, not deleted. An inaccurate warning needs correction, not preservation for sounding important. Treat legally required notices and machine-consumed directives as operational content, not explanatory prose; verify the requirement or consumer before proposing removal. A prose-documentation rule does not make narration useful: identify the conflict and recommend reconciling that rule rather than silently breaking its check. Deliberate bad-comment teaching samples are evidence fixtures, not production comments to clean up.

**Not here (another reviewer):**
- Type/lint suppression directives such as `@ts-ignore`, `# type: ignore` or `eslint-disable`: contract-bypass. Explanatory prose beside a directive still faces this aspect's trap test.

Sources / inspiration: product-specific zero-comment policy. Teaching excerpts state their external assumptions; they are not executed programs or model efficacy measurements.

## low-value-comments-B1 · REPORT

**Context:** The function's operations and callers are available. No external condition changes their meaning.

```typescript
// First discard expired sessions, then report whether this session remains.
function pruneSession(id: string): boolean {
  if (store.get(id)!.expiresAt < clock.now()) store.delete(id);
  return store.has(id);
}
```

**Why:** The comment restates the body. Removing it loses no hidden fact and exposes no maintenance trap. Delete it, without manufacturing a replacement warning.

## low-value-comments-B2 · REPORT

**Context:** This is a public export. Its implementation is available and no tool consumes the docstring.

```typescript
/** Returns the total in cents; throws RangeError for a negative quantity. */
export function totalCents(unitCents: number, quantity: number): number {
  if (quantity < 0) throw new RangeError("quantity must not be negative");
  return unitCents * quantity;
}
```

**Why:** Both the units and error are explicit in the name and body. Calling this API documentation does not create a hidden trap. Remove the docstring; public visibility does not reverse the verdict.

## low-value-comments-B3 · REPORT

**Context:** The finance integration's contract requires UTC ISO timestamps. Its rejection of other date formats is not represented by the row's string type.

```typescript
// Copy the id, format the date, then return the row. The finance importer
// rejects locale-formatted dates; keep the UTC ISO timestamp.
function toRow(record: Record): Row {
  return { id: record.id, date: record.date.toISOString() };
}
```

**Why:** Keep only the importer warning. The first sentence narrates code and obscures the one fact preventing a plausible but incompatible formatting change.

## low-value-comments-G1 · PRESERVE

**Context:** The vendor silently truncates a request after its first 50 IDs. The request schema accepts any array length; the integration contract establishes this behavior.

```typescript
// The vendor silently drops IDs after the first 50; larger batches lose work.
const batchSize = 50;
```

**Why:** A larger batch looks like a harmless optimization. The comment supplies the external behavior and data-loss consequence that the constant cannot express.

## low-value-comments-G2 · PRESERVE

**Context:** Closing the socket discards this queue library's acknowledged messages still in its internal buffer. Drain flushes that buffer; these external semantics are established by the library contract, not the caller's method names.

```go
// Close discards the library's acknowledged buffer; drain first to avoid loss.
queue.Drain()
socket.Close()
```

**Why:** The warning prevents a plausible shutdown reorder using a hidden library lifetime rule. It does not merely announce the current order.

## low-value-comments-G3 · PRESERVE

**Context:** A native binding retains the supplied buffer by reference until flush. Its signature and wrapper do not expose that ownership rule; the binding contract does.

```typescript
// The binding retains this buffer until flush; reusing it corrupts queued frames.
native.send(frame);
```

**Why:** The tempting buffer reuse is unsafe for a reason unavailable in the call's code or types. Even this short comment earns its place through a specific trap, not through public API status.
