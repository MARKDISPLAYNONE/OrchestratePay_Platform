---
name: orchestratepay-fraud-scoring
description: >
  Implement and tune the rule-based fraud scoring engine (util/fraud.ts) that gates every
  payment before the STK Push is dispatched. Covers the three scoring rules (velocity,
  amount deviation, high-amount first-transaction), score thresholds (ALLOW/REVIEW/DECLINE),
  Redis velocity counters, and how to tune rules via env vars. Use this skill when adding
  a new fraud rule, when legitimate payments are being declined, when investigating a fraud
  incident, or when tuning sensitivity for a specific merchant category.
---

# OrchestratePay — Fraud Scoring (`util/fraud.ts`)

## Decision model
```
scoreFraud(input) → { score: 0–100, decision: ALLOW | REVIEW | DECLINE, reasons: string[] }

0–69   → ALLOW    (proceed normally)
70–89  → REVIEW   (proceed, log for manual review, flag in DB)
90–100 → DECLINE  (return 402 Payment Required, code: FRAUD_DECLINED)
```

## Three scoring rules

### Rule 1 — Consumer velocity (Redis, O(1))
```
Increment Redis key: fraud:vel:{consumerId}  (TTL = VELOCITY_WINDOW_S, default 3600s)
If count > VELOCITY_MAX_TXNS (default 10):
  score += min(40, (count - maxTxns) × 8)
  reason: "velocity:{count}_txns_in_{window}s"
```
A consumer attempting 15 transactions in 1 hour adds `(15-10) × 8 = 40` to the score.

### Rule 2 — Amount deviation from merchant average (DB, 30-day window)
```
avg = AVG(amount_cents) of CONFIRMED transactions for this merchant, last 30 days
factor = proposedAmount / avg
If factor > AMOUNT_DEVIATION_FACTOR (default 5.0):
  score += min(30, floor((factor - 5) × 5))
  reason: "amount_deviation:{factor}x_merchant_avg"
```
A KSh 50,000 transaction at a merchant whose average is KSh 500 (factor=100) adds 30.

### Rule 3 — High-value first-time consumer (DB, all-time)
```
If amountCents > HIGH_AMOUNT_KES_CENTS (default 500,000 / KSh 5,000):
  If consumer has 0 CONFIRMED transactions (first-ever payment):
    score += 25
    reason: "high_amount_first_transaction:{cents}cents"
```

## Score composition
| Rule | Max contribution | Trips REVIEW at | Trips DECLINE at |
|---|---|---|---|
| Velocity | 40 | 4 excess transactions | 8+ excess transactions |
| Amount deviation | 30 | 5x average alone never trips — needs a second rule | Combined with others |
| High-value first | 25 | Alone: 25 (ALLOW) | Combined with velocity: 65 (ALLOW), with both: 95 (DECLINE) |
| Combined | 95 | 70 | 90 |

## Tuning via environment variables
| Variable | Default | Effect |
|---|---|---|
| `FRAUD_VELOCITY_WINDOW_S` | `3600` | Velocity tracking window (seconds) |
| `FRAUD_VELOCITY_MAX_TXNS` | `10` | Max transactions per consumer per window before scoring |
| `FRAUD_AMOUNT_FACTOR` | `5.0` | Deviation multiplier above merchant average before scoring |
| `FRAUD_HIGH_AMOUNT_CENTS` | `500000` | KSh 5,000 in cents — threshold for first-transaction rule |

## Fail-safe design
Each rule catches its own DB/Redis errors and logs a warning. A single rule failure does NOT
fail the payment — the rule is skipped with score contribution of 0. This ensures Redis
downtime doesn't block all payments.

## Integrating into a payment route
```typescript
import { scoreFraud } from '../util/fraud'

const fraud = await scoreFraud({
  consumerId, merchantId, amountCents, source, idempotencyKey
})

if (fraud.decision === 'DECLINE') {
  return res.status(402).json({
    error: 'Transaction declined by fraud prevention',
    code:  'FRAUD_DECLINED',
  })
}
// REVIEW: log to DB flag table; proceed with payment
if (fraud.decision === 'REVIEW') {
  logger.warn('Fraud REVIEW — proceeding', { score: fraud.score, reasons: fraud.reasons })
}
```

## Common failures
| Symptom | Cause | Fix |
|---|---|---|
| Legitimate payments declined | Thresholds too tight | Raise `FRAUD_VELOCITY_MAX_TXNS` or `FRAUD_HIGH_AMOUNT_CENTS` |
| New merchant's high-value transactions always REVIEW | No 30-day history for Rule 2 | `avg` is null/0 when no history — Rule 2 safely skips |
| Velocity counter never resets | Redis key not expiring | Counter TTL is set on first increment; check Redis TTL with `DEBUG OBJECT fraud:vel:{id}` |
| Fraud rules not firing | `util/fraud.ts` not integrated into route | Add `scoreFraud()` call to the payment route handler |
