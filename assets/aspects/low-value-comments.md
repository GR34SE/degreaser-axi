# Low-value comments

`low-value-comments` · default ON

**Question:** Would removing this comment lose a specific reason, constraint, contract or trap that names, types and nearby code do not convey?

**Applies when:** The change adds or edits comments or docstrings. Otherwise return not-applicable.

**Evidence:** Quote the comment and surrounding code. State what the comment adds beyond the symbol name, signature and visible statements. Check repository and language documentation conventions, and whether the symbol is part of a real public contract. Name the wrong maintenance decision the comment would prevent or the contract that would be lost; if you cannot, the comment is a candidate.

**Boundaries:** Preserve a comment whose removal would lose a rationale, a hidden constraint (ordering, concurrency, external-library or vendor behavior), a security fact, a real contract such as thrown errors or units, or a documentation obligation set by the language, a linter or repository docs, including required headers and tool directives. Being exported, written as JSDoc, long, or mentioning security is not enough; an export inside an internal module is not a public API unless the repository says so. Describing what the code visibly does, restating a name or signature, or narrating a sequence of steps is not rationale. When one useful fact is buried in narration, report the comment and recommend keeping only that fact. Only for a comment on the lines immediately beside a test assertion: matching arithmetic does not keep a comment that only repeats that assertion. When that comment's arithmetic does not equal the assertion, report it. If it also states a fact that appears nowhere else in the change, the recommendation keeps only that fact and does not offer to delete it.

**Not here (another reviewer):**
- Comments suppressing type checking or lint rules, such as @ts-ignore, # type: ignore or eslint-disable: contract-bypass.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

Sources / inspiration: S01. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## low-value-comments-B1 · REPORT

**Context:** The repository has no comment convention. The function is short and its steps are visible.

```typescript
// First we check whether the session has expired. If it has, we remove it
// from the store. Finally we return whether a session is still active.
function pruneSession(id: string): boolean {
  if (store.get(id)!.expiresAt < clock.now()) store.delete(id);
  return store.has(id);
}
```

**Why:** The comment narrates the three visible statements in order. It gives no reason, constraint or contract, and it will drift when the code changes.

## low-value-comments-B2 · REPORT

**Context:** `formatPrice` is exported from an internal module that no package entry point re-exports. No linter rule or repository document requires doc comments there.

```typescript
/**
 * Formats a price.
 * @param cents - The price in cents.
 * @param currency - The currency.
 * @returns The formatted price.
 */
export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);
}
```

**Why:** Every line repeats the name or the parameter types. Export and JSDoc form are not a documented contract. Public API documentation, or a stated rule requiring it, would reverse the verdict; see G3.

## low-value-comments-B3 · REPORT

**Context:** The comment is long, but one sentence holds a constraint the code does not show. The rest paraphrases the body.

```typescript
// This helper turns a record into a row for the export. It copies the id and
// the name, formats the date and returns the row. The finance system rejects
// rows whose date is not zero-padded ISO 8601, so keep toISOString.
function toRow(r: Record): Row {
  return { id: r.id, name: r.name, date: r.date.toISOString() };
}
```

**Why:** The paraphrase adds nothing and hides the external-system constraint. Report it and recommend keeping only the sentence about the date format, not removing the whole comment.

## low-value-comments-G1 · PRESERVE

**Context:** The vendor has a documented batch limit; the number does not follow from domain logic.

```typescript
// Vendor accepts at most 50 IDs per request; see integration contract.
const batchSize = 50;
```

**Why:** The comment preserves the reason for a constraint needed during future changes.

## low-value-comments-G2 · PRESERVE

**Context:** Resource shutdown order is a concurrency and data-loss trap that cannot easily be inferred from method names alone.

```go
// Drain before closing the socket so acknowledged messages are not lost.
queue.Drain()
socket.Close()
```

**Why:** The comment describes the consequence of incorrect ordering instead of repeating the code.

## low-value-comments-G3 · PRESERVE

**Context:** This is a public Go package. Go documentation conventions call for comments on exported names, and this repository enforces them with a linter.

```go
// GetUser returns the user with the given ID or ErrNotFound.
func GetUser(ctx context.Context, id string) (User, error) {
    return store.Get(ctx, id)
}
```

**Why:** The comment partly repeats the name but provides required public API documentation and an error contract. Similarity to B2 is not enough to report it.
