# Unjustified defensive code

`unjustified-defense` · default ON

**Question:** Does the extra validation, guard or error handler protect a real boundary or possible state?

**Applies when:** The change adds validation, type/null checks, guards, try/catch or retry around data or operations. Otherwise return not-applicable.

**Evidence:** Document the data path, upstream guarantees and every relevant entry into the function. Report only redundant checks for states that cannot occur.

**Boundaries:** Static types do not establish runtime validity. Network, disk, trust, public API and concurrency boundaries need protection.

**Not here (another reviewer):**
- Excess state, phases or passes in the main logic rather than in a check or handler: unnecessary-complexity.
- What an error handler returns, such as a fallback pretending success: masked-errors.
- Missing boundary validation, such as a cast instead of a check: contract-bypass. This aspect reports excessive checks, not absent ones.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## unjustified-defense-B1 · REPORT

**Context:** An internal function has one caller. That caller just parsed Order with OrderSchema.parse, and the object is not subsequently mutated. validateOrderShape repeats the same schema check over every order line.

```typescript
function total(order: Order) {
  validateOrderShape(order);
  return order.lines.reduce((sum, line) => sum + line.price, 0);
}
```

**Why:** Validation repeats an established guarantee with the same schema and no new boundary, traversing every line on each call. Evidence includes the actual data flow, not just a type annotation.

## unjustified-defense-B2 · REPORT

**Context:** parse_rows has a -> list[Row] contract and always returns a list. There is one entry in this closed path, no public API and no mutation of the result.

```python
rows = parse_rows(validated_csv)
if not isinstance(rows, list):
    raise TypeError("rows")
return summarize(rows)
```

**Why:** The check defends against a state prohibited by the producer's contract. It leaves a dead branch and misleading error rather than protecting untrusted input.

## unjustified-defense-B3 · REPORT

**Context:** After an explicit null return, the same unchanged argument is checked again in the same branch.

```typescript
if (user === null) return null;
if (user !== null) {
  return user.name;
}
```

**Why:** The second check protects no new state and adds a branch without changing the contract.

## unjustified-defense-G1 · PRESERVE

**Context:** A webhook is a network boundary. A RequestBody type annotation does not guarantee the shape of an incoming payload.

```typescript
const raw = await request.text();
await verifySignature(raw, request.headers);
const event = parseWebhookBody(JSON.parse(raw));
return handleEvent(event);
```

**Why:** This is a real trust boundary. Removing validation on the strength of types would be a review error.

## unjustified-defense-G2 · PRESERVE

**Context:** The library export also serves JavaScript callers without static type protection.

```typescript
export function setLimit(value: number) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError("limit");
  limit = value;
}
```

**Why:** Validation protects the public runtime contract. A number annotation does not establish caller-supplied values.

## unjustified-defense-G3 · PRESERVE

**Context:** expected_version comes from the client's If-Match header; current was read from the database during this request. save_with_version runs UPDATE … WHERE version = expected_version and raises ConflictError if no row changes.

```python
if current.version != expected_version:
    raise ConflictError()
save_with_version(current)
```

**Why:** The check explicitly rejects a client editing an outdated version. The conditional write handles races after the read. Both checks cover possible states; neither is redundant.
