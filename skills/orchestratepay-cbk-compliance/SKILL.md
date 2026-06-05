---
name: orchestratepay-cbk-compliance
description: >
  Enforce CBK (Central Bank of Kenya) e-money regulations via util/cbk-compliance.ts —
  KYC tier definitions (BASIC / ENHANCED / FULL), daily transaction limits per tier,
  the checkCbkCompliance() function that gates payments, the getDailySpendSummary()
  function for wallet UI, and the consumers.kyc_tier DB column. Use this skill when
  adding CBK limit enforcement to a payment route, when a consumer hits their daily limit,
  when upgrading a consumer's KYC tier, or when explaining regulatory limits to a merchant.
---

# OrchestratePay — CBK Regulatory Compliance (`util/cbk-compliance.ts`)

## Regulatory basis
Kenya's Central Bank of Kenya National Payment System Regulations 2014 (amended 2021)
mandate transaction limits based on customer due diligence (KYC) level.

## KYC tiers and daily limits
| Tier | KYC requirements | Daily limit | Balance limit |
|---|---|---|---|
| `BASIC` | Phone number only | KSh 10,000 | KSh 10,000 |
| `ENHANCED` | National ID + selfie | KSh 100,000 | KSh 100,000 |
| `FULL` | Full KYC (all documents) | No limit | No limit |

Limits in the code (KES cents):
```typescript
BASIC:    1_000_000    // KSh 10,000
ENHANCED: 10_000_000   // KSh 100,000
FULL:     Infinity     // No limit
```

## `checkCbkCompliance(consumerId, amountCents)` 
Queries:
1. Consumer's `kyc_tier` from the `consumers` table
2. Sum of `CONFIRMED` transactions for today (`date_trunc('day', NOW())`)

Returns:
```typescript
{ allowed: boolean, reason?, code?, limitCents?, usedCents? }
```

If `allowed = false`, the payment route should return:
```
HTTP 402 Payment Required
{ "error": "Daily spending limit for BASIC KYC tier would be exceeded", "code": "CBK_DAILY_LIMIT" }
```

## Fail-safe design
A DB failure in the compliance check **does NOT block the payment** — the function catches
all errors, logs them, and returns `{ allowed: true }`. This ensures a Redis/DB outage
doesn't make the payment platform unavailable. Log monitoring should alert on repeated
compliance check failures.

## Integrating into a payment route
```typescript
import { checkCbkCompliance } from '../util/cbk-compliance'

const compliance = await checkCbkCompliance(consumerId, amountCents)
if (!compliance.allowed) {
  return res.status(402).json({
    error: compliance.reason,
    code:  compliance.code,
    limitCents: compliance.limitCents,
    usedCents:  compliance.usedCents,
  })
}
```

## `getDailySpendSummary(consumerId)` — for wallet UI
Returns the consumer's current spending position to display in the wallet:
```typescript
{
  tier:           'BASIC',
  limitCents:     1_000_000,   // null for FULL tier
  usedCents:      250_000,     // KSh 2,500 spent today
  remainingCents: 750_000,     // KSh 7,500 remaining
}
```

## Upgrading a consumer's KYC tier
```sql
UPDATE consumers SET kyc_tier = 'ENHANCED' WHERE id = '{consumerId}';
```
Takes effect immediately — the next transaction check uses the new tier.

## Daily limit window
The limit resets at **midnight Kenyan time** (EAT, UTC+3). The query uses
`date_trunc('day', NOW())` which truncates to UTC midnight — for a Kenya-specific
implementation, use `date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi')`.

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| Consumer hits limit unexpectedly | Cancelled/declined transactions counted | Query filters `status = 'CONFIRMED'` only — verify cancelled txns don't show as CONFIRMED |
| FULL tier consumers getting limit errors | `kyc_tier` column missing or null | Run migration to add column with default `'BASIC'` |
| Limit not resetting at midnight | UTC vs EAT timezone | Switch `date_trunc` to use `Africa/Nairobi` timezone |
| Compliance check crashes payment route | Exception not caught | `checkCbkCompliance` already catches all errors and returns `{allowed: true}` |
