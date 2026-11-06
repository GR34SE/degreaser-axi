# Scope creep

`scope-creep` · default ON

**Question:** Does the change add features, permissions or refactoring not required by the supplied task?

**Applies when:** The caller supplies a concrete task with a feature scope. For a repository audit or a task without feature scope, such as 'review my changes', return not-applicable with that reason.

**Evidence:** Compare the diff with the supplied task, acceptance criteria and necessary implementation dependencies. Cite the task passage and the change it does not require. List each capability, permission or refactoring the change adds and judge each against the task, so one unrequested addition does not hide another.

**Boundaries:** Do not reconstruct the assignment from the diff or branch name. Shared-code changes needed by the task are not scope creep.

**Not here (another reviewer):**
- Required code that is not connected to the user path: incomplete-integration.
- An internal option or parameter without a consumer within the requested feature: speculative-flexibility.

Sources / inspiration: User requirements. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## scope-creep-B1 · REPORT

**Context:** Task: add list sorting. The change also alters permissions unrelated to sorting.

```typescript
const sorted = sortUsers(users);
permissions.allowGuestsToExport = true;
```

**Why:** The new guest capability is not a dependency of sorting. Refer to the supplied task.

## scope-creep-B2 · REPORT

**Context:** Task: fix CSV date formatting. The diff adds a new public JSON export endpoint.

```python
@route("/export.json")
def export_json():
    return build_json_export()
```

**Why:** This is a separate product feature, not a necessary part of fixing CSV formatting.

## scope-creep-B3 · REPORT

**Context:** The task concerns one validator. The diff changes global formatting rules and thousands of unrelated lines.

```javascript
// prettier.config.js
export default { singleQuote: true, printWidth: 140 };
```

**Why:** The unrelated change adds review cost and conflicts. The issue is its lack of connection to the task, not diff size alone.

## scope-creep-G1 · PRESERVE

**Context:** Task: accept NDJSON on the import endpoint. The endpoint uses shared/parse.ts, so the shared parser needs a new branch.

```typescript
// shared/parse.ts
case "application/x-ndjson": return parseNdjson(body);
```

**Why:** Changing a shared component is a necessary dependency of the task even when more than one file changes.

## scope-creep-G2 · PRESERVE

**Context:** The task includes migrating existing clients to a new contract.

```python
for client in affected_clients:
    update_contract_version(client, 2)
```

**Why:** The broad scope is explicitly requested. Do not penalize the size of the work without considering requirements.

## scope-creep-G3 · PRESERVE

**Context:** Task: fix parseAmount, which returned 1 rather than 10 cents for '0.10'. The diff fixes the parser and adds this case to its existing test.

```typescript
assert.equal(parseAmount("0.10"), 10);
```

**Why:** The regression case protects the fix. It is not an extension of product functionality.
