# Incomplete integration

`incomplete-integration` · default ON

**Question:** Is code required by the task connected to an actual user or consumer path?

**Applies when:** The task requires behavior reachable through a command, endpoint, export, registration or hook. Otherwise return not-applicable.

**Evidence:** Trace the entrypoint, registration, dispatch and consumer. Check the repository's actual registration mechanisms, such as decorators, autodiscovery and exports fields.

**Boundaries:** No rg match does not establish unreachability. If resolving the question requires execution, record the missing evidence rather than asserting a finding.

**Not here (another reviewer):**
- Code not requested by the task, even when disconnected: scope-creep.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## incomplete-integration-B1 · REPORT

**Context:** The task promises a working export command. Its new handler exists, but current dispatch still points to a stub.

```typescript
export const exportHandler = () => buildCsv();
const commands = { export: oldPlaceholder };
```

**Why:** The user path never reaches the implementation. The command registry is evidence, not merely absent rg matches.

## incomplete-integration-B2 · REPORT

**Context:** The API must run new validation before saving; the function was added, but the entrypoint still saves raw data.

```python
def validate_payload(payload):
    return schema.parse(payload)

def endpoint(payload):
    return save(payload)
```

**Why:** The required rule is absent from the actual path. Testing validate_payload alone cannot establish integration.

## incomplete-integration-B3 · REPORT

**Context:** The required SDK feature must be importable by package users. Its new file is not exported through the declared public entrypoint.

```typescript
export { oldFeature } from "./old-feature";
// new-feature.ts exists but is absent from the public entrypoint.
```

**Why:** Consumers using the promised public import cannot access it. Also inspect package exports and generated entrypoints.

## incomplete-integration-G1 · PRESERVE

**Context:** The consumer is external. The public entrypoint actually exports the new function.

```typescript
export { parseInvoice } from "./invoice";
```

**Why:** No internal call sites does not imply missing library integration. Inspect the public contract.

## incomplete-integration-G2 · PRESERVE

**Context:** The module resides in commands/, which the framework documentation says is automatically imported at startup. A decorator registers handlers; application code never calls the function directly.

```python
@commands.register("export")
def export_command():
    return build_csv()
```

**Why:** Autodiscovery and the decorator create a real connection. Searching only direct callers would produce a false finding. Without discovery or a module import, the decorator alone would not connect it.

## incomplete-integration-G3 · PRESERVE

**Context:** The task deliberately ships a feature behind an existing flag with an owner and rollout plan.

```typescript
if (flags.newCheckout) return newCheckout(order);
return currentCheckout(order);
```

**Why:** Disabling the feature for most users implements the rollout strategy. It is not forgotten integration.
