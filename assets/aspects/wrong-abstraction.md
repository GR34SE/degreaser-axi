# Wrong abstraction

`wrong-abstraction` · default ON

**Question:** Does a shared mechanism combine cases with divergent rules, accumulating flags and exceptions?

**Applies when:** The change creates or extends a shared function, component or class used by multiple cases. Otherwise return not-applicable.

**Evidence:** Show divergent consumer requirements and the resulting coupling. Justify a simpler separation.

**Boundaries:** Textual similarity alone does not justify merging, and flag count alone does not justify splitting.

**Not here (another reviewer):**
- A layer without behavior: unnecessary-layers.
- An option or variant without a current consumer: speculative-flexibility.
- One rule scattered through an overloaded unit without a shared mechanism for different cases: structural-erosion.

Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## wrong-abstraction-B1 · REPORT

**Context:** Payments and invitations have distinct lifecycles, but a shared function accumulates mutual exclusions.

```typescript
function run(input, options) {
  if (!options.invitationMode) charge(input);
  if (!options.skipEmail) sendEmail(input);
  if (options.invitationMode) createInvitation(input);
}
```

**Why:** Textually similar steps have merged different responsibilities. Changing one process requires understanding the other's flags.

## wrong-abstraction-B2 · REPORT

**Context:** A shared validator combines two contracts that interpret the same fields differently.

```python
def validate(data, mode):
    if mode == "invoice":
        require(data, "tax_id")
    elif mode == "guest":
        forbid(data, "tax_id")
```

**Why:** In this project there is no shared domain rule; the mechanism merges opposing policies only because the data shapes look similar. Changing the invoice tax-ID rule now touches a function also used by guest checkout.

## wrong-abstraction-B3 · REPORT

**Context:** A base component claims to be a shared form, but each consumer disables different responsibilities, and validation changes break independent screens.

```typescript
renderForm({ skipAddress: true, skipPayment: false, guestMode: true, ignoreRequired: true });
```

**Why:** Configuration exposes divergent contracts and coupling costs. Option count alone is insufficient; context establishes actual consumer conflicts.

## wrong-abstraction-G1 · PRESERVE

**Context:** Two processes genuinely follow the same rounding rule maintained under one contract.

```typescript
const invoiceTax = roundTax(invoice.tax);
const refundTax = roundTax(refund.tax);
```

**Why:** The shared mechanism represents shared meaning. Different caller names do not justify splitting it.

## wrong-abstraction-G2 · PRESERVE

**Context:** Two similar fragments represent independent rules with different owners and rates of change.

```python
def invoice_deadline(date):
    return date + invoice_terms()

def invitation_deadline(date):
    return date + invitation_terms()
```

**Why:** Preserving structural duplication protects separate meanings. Extracting one function with flags would worsen the model.

## wrong-abstraction-G3 · PRESERVE

**Context:** Serializer options describe a coherent public contract; every combination is meaningful and has current users.

```typescript
serialize(document, { indent: 2, trailingNewline: true });
```

**Why:** Several options within an abstraction do not prove it combines incompatible responsibilities.
