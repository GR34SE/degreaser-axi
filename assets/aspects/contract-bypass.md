# Contract bypass

`contract-bypass` · default ON

**Question:** Does a cast, type suppression or default value conceal an actual mismatch between data and its contract?

**Applies when:** The change adds a cast, non-null assertion, type/lint suppression, default for missing data or unchecked parsing at a boundary. Otherwise return not-applicable.

**Evidence:** Identify the contract, data source and mismatch hidden from the consumer by the suppression or default.

**Boundaries:** any, unknown, a cast or a suppression comment alone is insufficient. A narrow cast after validation or a documented gap in dependency types can be justified.

**Not here (another reviewer):**
- Handling an actual error by returning apparent success: masked-errors.
- Redundant checks on already guaranteed data: unjustified-defense.

Sources / inspiration: S01 S04. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## contract-bypass-B1 · REPORT

**Context:** Order requires an existing customerId for fulfillment. Request data is unvalidated.

```typescript
const order = request.body as Order;
await fulfill(order);
```

**Why:** The cast substitutes for a missing runtime guarantee and hides a potentially absent identifier from the consumer. Identify the concrete dependency in fulfill.

## contract-bypass-B2 · REPORT

**Context:** Zero means a free product, not a missing price. The payload does not guarantee amount.

```typescript
const amount = payload.amount ?? 0;
return charge(amount);
```

**Why:** The default superficially satisfies a numeric contract but turns missing data into a real business decision.

## contract-bypass-B3 · REPORT

**Context:** loadInvoice accepts invoiceId: number. The new caller has only customerId: string and suppresses the type error rather than locating that customer's invoice.

```typescript
// @ts-ignore
return loadInvoice(customerId);
```

**Why:** The suppression hides both a type and semantic mismatch: a customer identifier is supplied where an invoice identifier is required. ts-ignore alone is not evidence; the contract matters. See G3.

## contract-bypass-G1 · PRESERVE

**Context:** assertValidInvoice validates every Invoice field and throws on mismatch. It is declared as returning void rather than asserts value is Invoice, so SDK types do not see the narrowing.

```typescript
const value = sdk.read();
assertValidInvoice(value);
return value as Invoice;
```

**Why:** The narrow cast supports established validation instead of replacing it. Inspect what assertValidInvoice actually validates.

## contract-bypass-G2 · PRESERVE

**Context:** The public contract defines an omitted limit as 20; zero is separately invalid.

```typescript
const limit = request.limit ?? DEFAULT_LIMIT;
validateLimit(limit);
```

**Why:** The default implements the agreed meaning of an optional field rather than concealing missing required data.

## contract-bypass-G3 · PRESERVE

**Context:** Installed database-client types in version 4.2 omit signal, which the runtime supports according to its changelog (upstream issue #123). An integration test checks query cancellation.

```typescript
// @ts-expect-error -- types for db-client 4.2 omit `signal` (upstream #123)
await client.query(sql, { signal });
```

**Why:** The gap is in type declarations, not data. @ts-expect-error fails compilation when the types are fixed, making stale suppression visible. A suppression comment alone is not evidence of bypassing a contract.
