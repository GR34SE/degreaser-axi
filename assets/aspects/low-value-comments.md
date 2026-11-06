# Low-value comments

`low-value-comments` · default ON

**Question:** Does the added comment explain a reason, constraint or knowledge not visible in the code?

**Applies when:** The change adds or edits comments or docstrings. Otherwise return not-applicable.

**Evidence:** Quote the comment and surrounding code. Check repository and language documentation conventions, whether the symbol is public, and what knowledge the comment adds.

**Boundaries:** Preserve rationale, security information, public API documentation and required headers. A comment required by a language or repository convention, such as documentation of an exported Go name, stays even if it repeats the name.

**Not here (another reviewer):**
- Comments suppressing type checking or lint rules, such as @ts-ignore, # type: ignore or eslint-disable: contract-bypass.

Sources / inspiration: S01. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## low-value-comments-B1 · REPORT

**Context:** The repository does not require narrative comments on obvious statements.

```typescript
// Increase count by one.
count += 1;
```

**Why:** The comment repeats the visible operation without explaining a reason or constraint.

## low-value-comments-B2 · REPORT

**Context:** The function is private to the module, and the repository does not require docstrings. Its name describes the read; the comment adds no contract or special condition.

```python
# This function gets the user.
def get_user(user_id):
    return users.get(user_id)
```

**Why:** The information adds nothing to the name and single statement. Public API or required documentation conventions would reverse the verdict; see G3.

## low-value-comments-B3 · REPORT

**Context:** The comment comes from generation narration rather than a program requirement.

```typescript
// Now we gracefully handle the data in a robust way.
const result = parse(input);
```

**Why:** A generic quality claim explains neither behavior nor risk. It makes important notes harder to distinguish from filler.

## low-value-comments-G1 · PRESERVE

**Context:** The vendor has a documented batch limit; the number does not follow from domain logic.

```typescript
// Vendor accepts at most 50 IDs per request; see integration contract.
const batchSize = 50;
```

**Why:** The comment preserves the reason for a constraint needed during future changes.

## low-value-comments-G2 · PRESERVE

**Context:** Resource shutdown order matters but cannot easily be inferred from method names alone.

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
