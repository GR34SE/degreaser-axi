# A02 · Unnecessary layers

`unnecessary-layers` · default ON

**Question:** Does the wrapper, service, factory or interface provide necessary behavior or a boundary?

**Applies when:** The change adds or extends an intermediate layer: wrapper, service, factory, adapter, interface, re-export or delegating class. Otherwise return not-applicable.

**Evidence:** Trace caller → layer → implementation. Name the layer's cost and explain how necessary boundaries such as a public API, DI seam, transaction or model mapping would be preserved.

**Boundaries:** Do not report a layer just because it is short. Check consumers outside the module before recommending removal.

**Not here (another reviewer):**
- An option, parameter or extension point without a current consumer: A03.
- A shared layer combining cases with divergent rules and accumulating flags: A12.

Sources / inspiration: S04. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## A02-B1 · REPORT

**Context:** The layer is neither a public API, DI seam nor project boundary; every caller merely passes through it to the same service.

```typescript
class UserManager {
  constructor(private users: UserService) {}
  get(id: string) { return this.users.get(id); }
}
```

**Why:** Its only responsibility is forwarding. In this context it adds a type and navigation step without necessary behavior.

## A02-B2 · REPORT

**Context:** The application has one parser and no requirement for interchangeability, a public contract or resource initialization.

```python
class ParserFactory:
    def create(self):
        return CsvParser()

parser = ParserFactory().create()
```

**Why:** The factory makes no decision and establishes no useful boundary. Direct parser use preserves the required contract.

## A02-B3 · REPORT

**Context:** Two nearly identical interfaces are added in front of one internal adapter. Both belong to the same module, and the repository has no port/gateway convention.

```typescript
interface ReaderPort { read(id: string): Promise<User> }
interface ReaderGateway { read(id: string): Promise<User> }
const gateway: ReaderGateway = port;
```

**Why:** The second name requires synchronizing the same contract without a distinct owner or meaning. Check consumers before recommending removal.

## A02-G1 · PRESERVE

**Context:** The adapter separates an external SDK from a domain model that must remain stable when vendors change.

```typescript
async function findUser(id: string): Promise<User> {
  const record = await vendor.fetchAccount(id);
  return { id: record.account_id, name: record.display_name };
}
```

**Why:** The layer maps the model and maintains a real boundary. A wrapper is not inherently a defect.

## A02-G2 · PRESERVE

**Context:** Every payment operation requires a transaction and audit record; the wrapper owns that shared policy.

```typescript
async function charge(order: Order) {
  return db.transaction(async tx => {
    const result = await chargeInTransaction(tx, order);
    await writeAudit(tx, result);
    return result;
  });
}
```

**Why:** The layer adds required behavior and guarantees ordering. Removing it would change the contract.

## A02-G3 · PRESERVE

**Context:** The package maintains a stable export consumed outside the repository, although it currently delegates to a short internal function.

```go
func Parse(data []byte) (Document, error) {
    return parseV2(data)
}
```

**Why:** The public boundary has its own consumers. No additional logic in this version does not make the export redundant.
