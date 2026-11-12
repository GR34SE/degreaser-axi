# Speculative flexibility

`speculative-flexibility` · default ON

**Question:** Do new options, parameters, flags, plugins and configuration have a current requirement or consumer?

**Applies when:** The change adds an option, parameter, flag, variant, strategy, extension point or configuration field. Otherwise return not-applicable.

**Evidence:** Inspect the task, configurations, public contract and actual consumers of every new variant. Identify a variant without a consumer and the cost it introduces. List every option, parameter, flag or variant the change introduces and judge each one; when a required one is broader than the task needs, such as accepting several spellings where one is used, name the narrower form.

**Boundaries:** Populating or forwarding a field is not consuming its behavior: trace it to a current effect. No production caller does not invalidate a seam used by current deterministic tests, and no local caller does not mean no public API consumer. Record uncertainty when requirements are missing rather than asserting a defect.

**Not here (another reviewer):**
- State, phases or passes that serve current requirements in a more complicated way than needed, without an unused variant: unnecessary-complexity.
- A layer with no behavior or variants, such as pass-through code or a single-product factory: unnecessary-layers.
- Variants are used but have conflicting rules and accumulating mutual exclusions: wrong-abstraction.
- An unrequested user-facing product feature such as a format, endpoint or permission: scope-creep.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## speculative-flexibility-B1 · REPORT

**Context:** The task is an internal CSV export with one caller invoking exportCsv(rows, {}). There is no public API or requirement for custom delimiters, plugins or streaming. Every option has a separate implementation path.

```typescript
type ExportOptions = {
  delimiter?: string;
  plugins?: ExportPlugin[];
  strategy?: "buffered" | "streaming";
};
```

**Why:** The options add contracts and combinations to maintain and test without serving the current task. Check requirements and the caller instead of treating every option as excessive.

## speculative-flexibility-B2 · REPORT

**Context:** An internal job uses one transport; no actual consumer configures another transport.

```python
def make_sender(kind="http", plugin=None, resolver=None):
    if plugin is not None:
        return plugin(resolver)
    return HttpSender()
```

**Why:** No current path uses the extension points, and kind is accepted but ignored: kind="grpc" silently produces HTTP. These options suggest a contract the code does not implement.

## speculative-flexibility-B3 · REPORT

**Context:** The new flag is true at every call site and is neither a public contract nor a migration mechanism.

```typescript
function save(item: Item, enableFutureValidation = true) {
  if (enableFutureValidation) validate(item);
  return persist(item);
}
```

**Why:** The validation-disabled variant exists only for a hypothetical future and expands the space of invalid calls.

## speculative-flexibility-G1 · PRESERVE

**Context:** Two current products require different delivery channels, and both calls are visible.

```typescript
deliver(orderA, { channel: "email" });
deliver(orderB, { channel: "webhook" });
```

**Why:** Configuration serves actual requirements. The number of variants does not establish speculation.

## speculative-flexibility-G2 · PRESERVE

**Context:** The public SDK documentation promises custom transport, and documented consumers use it in offline deployments. The diff adds the option to the exported type.

```typescript
export interface ClientOptions {
  /** Custom transport for offline deployments; see docs/transports.md. */
  transport?: Transport;
}
```

**Why:** The extension point has an existing contract outside the repository. Local caller searches cannot invalidate it.

## speculative-flexibility-G3 · PRESERVE

**Context:** An approved migration supports old and new formats until 2027-03-31; producers still emit both.

```python
if payload.version == 1:
    return decode_v1(payload)
return decode_v2(payload)
```

**Why:** Compatibility has current consumers and a removal date. It is not flexibility for a hypothetical future.
