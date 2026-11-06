# Failure to reuse existing solutions

`missed-reuse` · default ON

**Question:** Does the change implement a mechanism already provided by the repository, an installed dependency, framework or platform with the required contract?

**Applies when:** The change adds a custom implementation of contracted behavior, such as a client, retry, cache, logging, randomness or error mapping, or copies existing code. Otherwise return not-applicable.

**Evidence:** Identify the existing component and quote its use in the repository or its declaration in an installed dependency. Show that its contract meets the requirement and name the cost of bypassing it. Search may skip ignored directories such as node_modules; read dependencies by path. An API claim without such evidence belongs in uncertainty, not a finding.

**Boundaries:** Do not impose Effect on projects without Effect. Matching names are insufficient: the existing helper may have a different contract.

**Not here (another reviewer):**
- No equivalent exists in the repository or its dependencies, and the suggestion involves adding a library: reinvented-infrastructure.
- A single expression or loop replaceable by a language or standard-library construct such as map, Set or join: unidiomatic-code.
- Nothing is duplicated; the change merely departs from an established repository pattern in format, channel or naming: convention-drift.

Sources / inspiration: S04 S24. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## missed-reuse-B1 · REPORT

**Context:** The simulation module uses Effect v4. Reproducible randomness through Random.withSeed is required, but the new helper bypasses the Random service.

```typescript
const sample = Effect.sync(() => Math.random());
```

**Why:** The call bypasses the framework's replaceable service, so the program seed does not control it. Cite the requirement and the available Random.next API; Math.random alone is not evidence.

## missed-reuse-B2 · REPORT

**Context:** The repository has apiClient.get with retry, logging and error mapping. Other endpoints in this module use it. A new endpoint adds its own loop for the same contract.

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  try { return await fetchUserDirectly(id); }
  catch (error) { if (attempt === 2) throw error; }
}
```

**Why:** The new path does not log and returns unmapped errors. Its retry policy will diverge when apiClient changes. Evidence comes from the client's contract and use in this module, not the presence of a loop.

## missed-reuse-B3 · REPORT

**Context:** The project provides cache.getOrLoad with the TTL and capacity limit this module requires. A new file builds its own cache.

```typescript
const entries = new Map<string, { value: User; expiresAt: number }>();
export async function getUser(id: string): Promise<User> {
  const entry = entries.get(id);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  const value = await loadUser(id);
  entries.set(id, { value, expiresAt: Date.now() + 60_000 });
  return value;
}
```

**Why:** Custom TTL handling duplicates an existing responsibility and omits the shared memory limit, allowing unbounded map growth. Identify the existing module and required behavior instead of merely saying to use a library.

## missed-reuse-G1 · PRESERVE

**Context:** The repository's apiClient automatically retries every request up to three times after network failures. The new call charges a card, and the payment provider does not support idempotency keys.

```typescript
// apiClient retries every request; a retried charge could bill the customer twice.
const res = await fetch(`${paymentsUrl}/charges`, { method: "POST", body: JSON.stringify(charge) });
```

**Why:** Automatic retries conflict with this operation's requirements. Bypassing the client is justified and documented. A helper with a matching name does not prove it should be used.

## missed-reuse-G2 · PRESERVE

**Context:** The shared project client satisfies the user-fetch contract: retry, logging and error mapping.

```typescript
export const loadUser = (id: string) => apiClient.get(`/users/${id}`);
```

**Why:** The change reuses the existing client instead of building another fetching mechanism. This is the behavior missed-reuse expects.

## missed-reuse-G3 · PRESERVE

**Context:** A recovery-token generator requires cryptographically secure randomness. The project uses Effect v4. Effect Random is not cryptographically secure. In the installed version, effect/crypto/SecureRandom is unstable, and repository instructions prohibit unstable production APIs.

```typescript
import { randomBytes } from "node:crypto";
const token = randomBytes(32).toString("hex");
```

**Why:** Security requirements and repository policy justify the platform mechanism. If unstable APIs were permitted, SecureRandom.randomBytes would be the reuse candidate, never Random.next.
