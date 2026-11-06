# Custom infrastructure instead of a mature solution

`reinvented-infrastructure` · default ON

**Question:** Does the change add handwritten general-purpose infrastructure that fails to implement known problem semantics, when neither the repository nor its dependencies provides an equivalent?

**Applies when:** The change adds a custom general-purpose mechanism, such as an evicting cache, standard-format parser, scheduler/cron, time-zone arithmetic, retry with backoff or cryptographic primitive. Otherwise return not-applicable.

**Evidence:** Use source evidence only. Inspect the manifest and repository to establish that no equivalent exists, then demonstrate a concrete semantic case the code misses, such as CSV quoting or a daylight-saving transition. Also inspect dependency restrictions.

**Boundaries:** The reviewer cannot browse or verify libraries. Recommendations name missing semantics and suggest considering a mature solution. Library names may appear only as unverified suggestions in uncertainty; selection and verification belong to the caller. Small code satisfying its actual bounded contract is not slop. Popularity alone is never evidence.

**Not here (another reviewer):**
- An equivalent already exists in the repository, installed dependencies, framework or platform: missed-reuse.
- A single expression replaceable by a language or standard-library construct: unidiomatic-code.

Sources / inspiration: User requirements. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## reinvented-infrastructure-B1 · REPORT

**Context:** A new module implements a general cache with TTL, LRU eviction and a memory limit. The manifest and repository contain no cache, and runtime dependencies are permitted. Expired entries are removed only when that same key is read.

```typescript
class LocalCache<V> {
  private entries = new Map<string, { value: V; expiresAt: number }>();
  private touchOrder: string[] = [];
  get(key: string): V | undefined { return this.lookupAndEvict(key); }
}
```

**Why:** The team takes on general infrastructure maintenance with an already visible semantic gap: expired, unread keys never release memory, so the memory limit is not enforced. Show this case and the lack of an existing equivalent. Leave library selection to the caller.

## reinvented-infrastructure-B2 · REPORT

**Context:** Task: import customer CSV files exported by Excel. Fields may contain commas, quotes and newlines. The repository has no CSV parser, as confirmed by its manifest.

```typescript
const rows = text.split("\n").map(line => line.split(","));
```

**Why:** The implementation misses format semantics: a quoted field such as "Smith, Jane" becomes two columns, and a quoted newline becomes a false row. Cite the counterexample and recommend an RFC 4180-compatible parser without claiming a particular library version supports it.

## reinvented-infrastructure-B3 · REPORT

**Context:** The function must handle user-supplied cron expressions with lists, ranges, steps and weekdays. The repository has no cron parser. Time zones come from zoneinfo.

```python
def next_run(cron: str, now: datetime, tz: ZoneInfo) -> datetime:
    minute, hour = (int(f) for f in cron.split()[:2])
    local = now.astimezone(tz)
    run = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return run if run > local else run + timedelta(days=1)
```

**Why:** Fields 3–5 are ignored, so 0 9 * * 1-5 also runs on weekends, while */15 cannot be parsed. Adding timedelta(days=1) uses wall time and can yield a nonexistent time at a daylight-saving transition. Name these cases; a custom scheduling engine is not the application's differentiator.

## reinvented-infrastructure-G1 · PRESERVE

**Context:** Requirement: retain the 50 most recent results, with no TTL or byte limit. Repository AGENTS.md requires zero runtime dependencies for this CLI.

```typescript
cache.delete(key);
cache.set(key, value);
if (cache.size > MAX_ENTRIES) {
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}
```

**Why:** Map insertion order implements the entire required LRU contract, and repository policy excludes a dependency. Reporting would require inventing requirements such as TTL or a memory limit.

## reinvented-infrastructure-G2 · PRESERVE

**Context:** The format is closed and deliberately not CSV: every line has two fields without internal separators, validated at entry.

```python
key, value = line.split(":", 1)
```

**Why:** A simple parser satisfies the actual contract. Do not expand the problem to a full standard just to justify a library.

## reinvented-infrastructure-G3 · PRESERVE

**Context:** Signing requires a private domain rule not implemented by general libraries. Cryptographic mechanics come from an approved tool.

```typescript
const canonical = encodeDomainFields(invoice);
return approvedSigner.sign(canonical);
```

**Why:** Custom code covers product-specific semantics while reusing general mechanics. No library covering the entire rule does not imply slop.
