# Masked errors

`masked-errors` · default ON

**Question:** Does handling an actual error turn failure into apparent success or another misleading response?

**Applies when:** The change catches, ignores or translates errors and unsuccessful results: try/catch, .catch, err/status checks or fallbacks after failure. Otherwise return not-applicable.

**Evidence:** Show the original error, fallback path and observable result that contradicts the caller's contract.

**Boundaries:** Handling an expected error or explicitly degraded behavior is not automatically slop. Retry that eventually propagates the error does not conceal it.

**Not here (another reviewer):**
- Whether a check or handler is needed at all, such as redundant validation or try around a non-throwing operation: unjustified-defense.
- A cast, type suppression or default for missing data when no error has occurred: contract-bypass.

Sources / inspiration: S01 S05. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## masked-errors-B1 · REPORT

**Context:** The API must confirm durable order storage; database failure is not an allowed degradation.

```typescript
try { await saveOrder(order); }
catch { return { success: true }; }
```

**Why:** Storage failure becomes a success claim. The caller cannot distinguish an order that was never persisted.

## masked-errors-B2 · REPORT

**Context:** A report of no outstanding debt must rely on a successful database read.

```python
try:
    debts = load_debts()
except DatabaseError:
    debts = []
return {"debt_count": len(debts)}
```

**Why:** Unavailable data is presented as zero debt, changing the report's meaning.

## masked-errors-B3 · REPORT

**Context:** fetchUser returns null for a nonexistent user (404) and rejects on timeout or 5xx. The handler maps null to HTTP 404.

```typescript
const user = await fetchUser(id).catch(error => { log(error); return null; });
if (user === null) return notFound();
```

**Why:** Provider failure becomes a nonexistent-user response. A client may remove a cached account or display an incorrect message; logging does not fix the response. Show the two meanings of null and their observable consequence.

## masked-errors-G1 · PRESERVE

**Context:** Recommendations are optional; the response exposes degradation and preserves the page's core function.

```typescript
try { return { items: await recommendations(), degraded: false }; }
catch { return { items: [], degraded: true }; }
```

**Why:** The contract permits an empty section and distinguishes degradation from complete success.

## masked-errors-G2 · PRESERVE

**Context:** The endpoint maps an expected conflict to an explicit domain result.

```python
try:
    reserve(seat)
except AlreadyReserved:
    return {"status": "unavailable"}
```

**Why:** The error remains visible: the caller receives correct information that reservation is unavailable.

## masked-errors-G3 · PRESERVE

**Context:** A required resource has bounded retry, and the final failure propagates.

```typescript
try { return await fetchReport(); }
catch (firstError) {
  await delay(100);
  return await fetchReport();
}
```

**Why:** A second failure still rejects the operation. Retry is not itself error masking; assess its parameters separately.
