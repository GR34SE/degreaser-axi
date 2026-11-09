# Verification theater

`verification-theater` · default ON

**Question:** Does this check distinguish the promised valid and invalid states using observations relevant to that promise?

**Applies when:** The change adds or edits verification in runtime code, CI, scripts or tools: checks, validators, check/verify/doctor commands, checksums or health checks. Otherwise return not-applicable.

**Evidence:** Identify the claimed property, observed object, source of expectations and acceptance predicate. Show a concrete bad state accepted or valid state wrongly rejected. Trace whether a reported fact was directly observed, inferred from configuration or merely declared. Identify any shared error that the claimed check cannot detect.

**Boundaries:** Independence is relative to the promised property. Shared schemas or helpers can protect transfer, packaging or generation drift without proving the shared contract's semantic correctness. Two uses of a helper do not alone prove self-confirmation. Do not turn declarations into observed results or call a false rejection a false success.

**Not here (another reviewer):**
- Code executed exclusively by a test runner, including tests, test helpers and fixtures: low-value-tests.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## verification-theater-B1 · REPORT

**Context:** The validator must detect manifest-generator errors, but both sides of its comparison use the same implementation.

```typescript
const actual = generateManifest(input);
const expected = generateManifest(input);
return deepEqual(actual, expected);
```

**Why:** A shared error remains invisible. The check claims independent confirmation it cannot provide.

## verification-theater-B2 · REPORT

**Context:** Assume from hashlib import sha256. The mechanism must verify a file write, but it compares the input buffer with a copy rather than reading the stored result.

```python
write_file(path, payload)
verified = sha256(payload).hexdigest() == sha256(payload[:]).hexdigest()
```

**Why:** The comparison always returns True and never observes the possible failure location. Identify the gap between the promise and the object actually checked.

## verification-theater-B3 · REPORT

**Context:** A check command must confirm actual resources conform to a schema, but reads only the tool's static capability declaration.

```typescript
const capabilities = { validatesSchema: true };
return { verified: capabilities.validatesSchema };
```

**Why:** A capability declaration is not a verification result. verified would mislead the caller.

## verification-theater-G1 · PRESERVE

**Context:** The check must confirm transfer integrity; the expected digest comes from independently obtained, authenticated metadata.

```typescript
const downloaded = await readDownloadedFile(path);
assert.equal(hash(downloaded), trustedManifest.sha256);
```

**Why:** The comparison observes the transfer result against an independent contract. Two uses of hashing do not imply self-confirmation.

## verification-theater-G2 · PRESERVE

**Context:** The validator checks generated data against schema_v2: a versioned JSON Schema file approved by the consumer, not generated from the producer's models.

```python
result = generate_payload(input_data)
validate_against_contract(result, schema_v2)
```

**Why:** Expectations are independent of the generator and can detect its error. A schema generated from the same types would miss a shared mistake, so inspect schema provenance.

## verification-theater-G3 · PRESERVE

**Context:** The command only reports capabilities and does not claim to verify them in this environment.

```typescript
return { supportsSchemaValidation: true, verification: "not-run" };
```

**Why:** It clearly distinguishes a declaration from an observation. There is no misleading verification to report.
