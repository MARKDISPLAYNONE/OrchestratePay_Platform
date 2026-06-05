---
name: orchestratepay-vat
description: >
  Apply Kenya Revenue Authority (KRA) VAT calculations on OrchestratePay transactions.
  Covers the 16% standard rate back-calculation from VAT-inclusive amounts, the KRA-prescribed
  floor (truncation) rounding rule, the vatBreakdown() helper for receipt printing and fiscal
  log entries, zero-rate and custom-rate scenarios, and the integer-cents invariant that
  prevents floating-point rounding errors. Use this skill when printing KRA-compliant receipts,
  recording VAT in the fiscal_log table, building accounting GL entries that require net/VAT
  split, or when adding support for reduced or zero-rated goods.
---

# OrchestratePay — KRA VAT Calculations (`util/vat.ts`)

## Kenya VAT at a glance
- Standard rate: **16%** (`VAT_RATE = 0.16`)
- OrchestratePay collects **VAT-inclusive** amounts (consumers pay the total price)
- For receipts and accounting, the VAT portion must be back-calculated from the inclusive total
- All amounts are **integer cents** (KSh × 100) — never floating-point KSh

## Formula — back-calculating VAT from inclusive total
```
vatCents = floor( totalCents × (rate / (1 + rate)) )
netCents = totalCents - vatCents
```
KRA prescribes **floor (truncation)**, not round or ceil. Any fractional cent is discarded.

## API
```typescript
import { vatFromInclusive, netFromInclusive, vatBreakdown, VAT_RATE } from '../util/vat'

vatFromInclusive(50_000)           // → 6896  (VAT portion of KSh 500.00)
netFromInclusive(50_000)           // → 43104 (net ex-VAT)

vatBreakdown(50_000)
// → { totalCents: 50000, vatCents: 6896, netCents: 43104, vatRate: 0.16 }
```

## Receipt example — KSh 500.00 transaction
```
Total (incl. VAT 16%)  KSh  500.00
  Net amount           KSh  431.04
  VAT (16%)            KSh   68.96
KRA PIN: P051234567X
M-Pesa Ref: ODE3K5Z8
```

Cents: total=50,000 · net=43,104 · vat=6,896 · net+vat=50,000 ✓

## Worked examples
| Total (KSh) | Total (cents) | VAT cents | Net cents |
|---|---|---|---|
| 116.00 | 11,600 | 1,600 | 10,000 |
| 100.00 | 10,000 | 1,379 | 8,621 |
| 500.00 | 50,000 | 6,896 | 43,104 |
| 1.00 | 100 | 13 | 87 |

## Custom rates
Both `vatFromInclusive` and `vatBreakdown` accept an optional second argument:
```typescript
vatFromInclusive(10_000, 0)      // → 0    (zero-rated goods)
vatFromInclusive(10_000, 0.08)   // → 740  (hypothetical reduced rate)
vatBreakdown(10_000, 0)          // → { vatCents: 0, netCents: 10000, ... }
```

## Fiscal log integration
Every transaction produces a `fiscal_log` row. The VAT breakdown populates it:
```typescript
const { vatCents, netCents } = vatBreakdown(transaction.amount_cents)
await db.query(
  `INSERT INTO fiscal_log (transaction_id, gross_cents, vat_cents, net_cents, vat_rate)
   VALUES ($1, $2, $3, $4, $5)`,
  [txnId, transaction.amount_cents, vatCents, netCents, VAT_RATE]
)
```

## Accounting GL entries
When posting to QuickBooks / Xero / Sage via `jobs/gl-posting.ts`, the journal entry splits the gross into net revenue + VAT payable:
```
DR  Accounts Receivable    50,000 cents  (gross)
CR  Revenue                43,104 cents  (net)
CR  VAT Payable             6,896 cents  (tax)
```

## Integer invariant
`netCents + vatCents === totalCents` is guaranteed by construction — the net is
`totalCents - vatCents` (no independent calculation). This ensures receipts and ledger
entries always balance to the cent.

## Common mistakes
| Mistake | Correct approach |
|---|---|
| Calculating VAT as `totalCents × 0.16` | This gives VAT on net, not inclusive. Use `totalCents × (0.16/1.16)` |
| Using `Math.round` instead of `Math.floor` | KRA prescribes truncation — use `Math.floor` |
| Storing KSh as a float (e.g. `500.00`) | Always store as integer cents (50000) — floats cause rounding drift |
| Adding calculated VAT to totalCents | VAT is already inside the inclusive total — only back-calculate |

## See also
- `orchestratepay-payments-domain` — PCI DSS scope, CBK compliance, fiscal receipt requirements
- `orchestratepay-accounting-integrations` — GL posting and journal entry structure
