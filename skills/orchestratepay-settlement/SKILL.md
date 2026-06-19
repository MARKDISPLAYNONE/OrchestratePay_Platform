# OrchestratePay Settlement

Authoritative reference for the merchant settlement subsystem. This feature does **not yet exist** in the codebase — this document is the architecture plan. Settlement is a **P0 blocker for go-live**: without it, M-Pesa float accumulates in Safaricom's ecosystem and merchants cannot receive funds in their bank accounts.

## What Settlement Means

When a consumer pays via M-Pesa STK Push, the funds land in OrchestratePay's M-Pesa shortcode float — a Safaricom-side holding wallet. The merchant has been credited on OrchestratePay's internal ledger (the `transactions` table shows `CONFIRMED`), but no money has actually moved to the merchant's bank account yet.

Settlement is the process of disbursing the accumulated float from the shortcode to each merchant's registered bank account via Daraja's B2B (Business-to-Business) API. It answers the question: "Of all the payments confirmed today, how much does each merchant get, and when does it hit their account?"

## Why It Is Blocking Go-Live

Until settlement is implemented:
- Merchants confirm payments on-screen but receive no money
- The platform holds float indefinitely with no automated disbursal mechanism
- There is no audit trail of what has been paid out vs. what is owed
- Merchants cannot trust the system in production

This is the single highest-priority unimplemented feature in the platform.

## Intended Architecture

### Settlement Account Registration

Each merchant registers a settlement destination before payments can be processed. This is stored in a `settlement_accounts` table:

```sql
CREATE TABLE settlement_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  account_type    TEXT NOT NULL CHECK (account_type IN ('BANK', 'MPESA_BUSINESS')),
  bank_name       TEXT,                    -- e.g. "Equity Bank"
  bank_code       TEXT,                    -- Pesalink/SWIFT bank code
  account_number  TEXT NOT NULL,
  account_name    TEXT NOT NULL,           -- must match bank records for compliance
  mpesa_shortcode TEXT,                    -- for MPESA_BUSINESS type
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ON settlement_accounts(merchant_id) WHERE active = TRUE;
```

Only one active settlement account per merchant is allowed (unique partial index). The `verified` flag is set by an admin after manual KYC verification — unverified merchants cannot receive settlement.

### Settlement Records Table

```sql
CREATE TABLE settlements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id       UUID NOT NULL REFERENCES merchants(id),
  settlement_account_id UUID NOT NULL REFERENCES settlement_accounts(id),
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  gross_amount_cents BIGINT NOT NULL,
  fee_cents         BIGINT NOT NULL DEFAULT 0,
  net_amount_cents  BIGINT NOT NULL,        -- gross - fee
  transaction_count INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','ON_HOLD')),
  daraja_request_id TEXT,                  -- B2B ConversationID
  daraja_receipt    TEXT,                  -- M-Pesa reference on completion
  initiated_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON settlements(merchant_id, period_end DESC);
CREATE INDEX ON settlements(status) WHERE status IN ('PENDING','PROCESSING');
```

Each settlement record covers a time window (`period_start` → `period_end`) and captures the aggregated confirmed revenue for one merchant. Fee deduction happens here — the platform takes a percentage before disbursing.

### Settlement State Machine

```
PENDING ──► PROCESSING ──► COMPLETED
              │
              └──► FAILED ──► PENDING (admin retry)
              
ON_HOLD  (manual admin hold — dispute, compliance flag, KYC gap)
```

| State | Meaning |
|---|---|
| `PENDING` | Calculated, awaiting Daraja B2B call |
| `PROCESSING` | B2B call accepted, awaiting async confirmation |
| `COMPLETED` | Daraja confirmed receipt; funds are in merchant's account |
| `FAILED` | B2B call rejected or callback confirmed failure |
| `ON_HOLD` | Admin-placed hold; never auto-transitions |

### Nightly Settlement Job

The settlement job runs on a T+1 basis by default: every night at 23:00 EAT (20:00 UTC), it settles all `CONFIRMED` transactions from the previous calendar day.

```typescript
// src/jobs/settlement.ts (to be created)
import cron from 'node-cron'
import { db } from '../db/index'
import { initiateB2bPayout } from '../integrations/daraja'
import { logger } from '../util/logger'

// Nightly at 23:00 Nairobi time (20:00 UTC)
cron.schedule('0 20 * * *', async () => {
  await runSettlementJob()
})

async function runSettlementJob(): Promise<void> {
  const yesterday = getPreviousBusinessDay()   // skip weekends if needed

  // 1. Find all merchants with unsettled CONFIRMED transactions in the period
  const { rows: merchantSummaries } = await db.query(`
    SELECT
      t.merchant_id,
      COUNT(*)          AS transaction_count,
      SUM(t.amount_cents) AS gross_amount_cents,
      MIN(t.confirmed_at) AS period_start,
      MAX(t.confirmed_at) AS period_end
    FROM transactions t
    WHERE t.status = 'CONFIRMED'
      AND t.confirmed_at >= $1
      AND t.confirmed_at <  $2
      AND t.merchant_id NOT IN (
        -- Skip merchants with an active settlement for this period
        SELECT merchant_id FROM settlements
        WHERE period_start >= $1 AND status NOT IN ('FAILED')
      )
    GROUP BY t.merchant_id
    HAVING SUM(t.amount_cents) >= $3    -- minimum threshold (e.g. 100000 = KSh 1000)
  `, [yesterday.start, yesterday.end, MINIMUM_SETTLEMENT_CENTS])

  for (const summary of merchantSummaries) {
    await settleForMerchant(summary, yesterday)
  }
}
```

### Minimum Settlement Threshold

```typescript
const MINIMUM_SETTLEMENT_CENTS = parseInt(process.env.SETTLEMENT_MIN_CENTS ?? '100000')
// Default: KSh 1,000. Merchants with less accumulated revenue are carried over
// to the next settlement cycle. This reduces Daraja B2B API call volume.
```

### Fee Calculation

```typescript
const PLATFORM_FEE_RATE = parseFloat(process.env.SETTLEMENT_FEE_RATE ?? '0.015')
// Default: 1.5% platform fee on gross amount

function calculateFee(grossCents: number): number {
  return Math.ceil(grossCents * PLATFORM_FEE_RATE)
}
```

The net amount disbursed is `gross - fee`. The fee stays in OrchestratePay's shortcode. This is the platform's revenue model.

### Daraja B2B Integration

Settlement uses Safaricom's B2B (Business-to-Business) API, which is different from the B2C API used for refunds:

```typescript
// src/integrations/daraja.ts (to be extended)
export async function initiateB2bPayout(params: {
  settlementId: string
  merchantId:   string
  amountCents:  number
  bankCode:     string
  accountNumber: string
  accountName:  string
}): Promise<{ requestId: string }> {
  // POST https://sandbox.safaricom.co.ke/mpesa/b2b/v1/paymentrequest
  // CommandID: 'BusinessPayBill' for bank transfers
  // CommandID: 'BusinessBuyGoods' for M-Pesa shortcode transfers
  // Requires separate B2B OAuth credentials (DARAJA_B2B_CONSUMER_KEY, _SECRET)
}
```

The B2B call is asynchronous — Daraja accepts the request and returns a `ConversationID`. The actual payment confirmation arrives via a separate webhook (B2B Result URL). A new route `POST /api/v1/settlement-callback` must be added to handle this, analogous to `mpesa-callback.ts`.

### Hold Periods

Certain merchants or transactions may be placed on settlement hold:
- New merchants (first 30 days): 48-hour hold on each settlement
- Disputed transactions: held until dispute resolution
- Compliance flag: admin manually sets `ON_HOLD` status

```sql
-- Hold new merchant settlements for 48 hours
AND m.created_at < NOW() - INTERVAL '48 hours'
```

### T+0 vs T+1 Configuration

```typescript
const SETTLEMENT_SCHEDULE = process.env.SETTLEMENT_SCHEDULE ?? 'T+1'
// T+0: same-day settlement (runs at 23:00 same day, risky for disputes)
// T+1: next-day settlement (default — allows time for dispute flag)
// T+2: 2-day settlement (most conservative; KCB/Equity Bank standard)
```

## Required Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DARAJA_B2B_CONSUMER_KEY` | OAuth client key for B2B API (separate from STK credentials) | `abc123` |
| `DARAJA_B2B_CONSUMER_SECRET` | OAuth client secret for B2B API | `xyz789` |
| `DARAJA_B2B_SHORTCODE` | OrchestratePay's B2B shortcode | `174379` |
| `DARAJA_B2B_RESULT_URL` | Webhook URL for B2B payment confirmations | `https://api.orchestratepay.co.ke/api/v1/settlement-callback` |
| `DARAJA_B2B_TIMEOUT_URL` | Webhook URL for B2B timeouts | `https://api.orchestratepay.co.ke/api/v1/settlement-callback/timeout` |
| `SETTLEMENT_MIN_CENTS` | Minimum balance to trigger settlement | `100000` (KSh 1,000) |
| `SETTLEMENT_FEE_RATE` | Platform fee as a decimal | `0.015` (1.5%) |
| `SETTLEMENT_SCHEDULE` | T+0, T+1, or T+2 | `T+1` |

## Files to Create

| File | Purpose |
|---|---|
| `src/jobs/settlement.ts` | Nightly job: aggregate, fee calc, B2B call |
| `src/routes/settlement.ts` | Merchant view of settlement history; admin hold/release |
| `src/routes/settlement-accounts.ts` | Merchant registers bank account; admin verifies |
| `src/routes/settlement-callback.ts` | Receives B2B result from Daraja (like mpesa-callback.ts) |
| `src/integrations/daraja.ts` | Add `initiateB2bPayout()` function |
| `src/db/migrations/003_settlement.sql` | `settlement_accounts` and `settlements` tables |

## Integration with Existing Cron Pattern

The settlement job should follow the same pattern as `gl-posting.ts` and `subscription-billing.ts`:

```typescript
// In src/index.ts, add after existing cron registrations:
cron.schedule('0 20 * * *', async () => {   // 20:00 UTC = 23:00 EAT
  try {
    await runSettlementJob()
  } catch (err: any) {
    logger.error('Settlement job failed', { error: err.message })
  }
})
```

Use `src/util/distributed-lock.ts` (Redlock) to prevent double-settlement in multi-replica deployments — identical to the reconciliation job pattern.

## Audit Requirements

Every settlement action must be logged at the row level. The `settlements` table itself is the audit trail, but additionally:

- Every status transition must update `updated_at` and log via `logger.info`
- `daraja_request_id` and `daraja_receipt` must be stored for CBK 7-year retention
- Fees must be stored separately from gross amounts — never overwrite gross with net
- Failed settlements must retain `failure_reason` — never delete failed rows

## Admin API Design (to be implemented)

```
GET  /api/v1/admin/settlements           — list all settlements, filterable by status/merchant/date
GET  /api/v1/admin/settlements/:id       — settlement detail with transaction breakdown
POST /api/v1/admin/settlements/:id/hold  — place ON_HOLD
POST /api/v1/admin/settlements/:id/release — release from ON_HOLD back to PENDING
POST /api/v1/admin/settlements/:id/retry — re-trigger B2B for FAILED settlements
```

Merchant-facing:
```
GET  /api/v1/settlements                 — merchant's own settlement history
GET  /api/v1/settlements/:id            — single settlement detail
GET  /api/v1/settlements/:id/transactions — which transactions are in this settlement
```

## Common Pitfalls to Avoid

### Double-settlement

Use the `ON CONFLICT DO NOTHING` pattern or a distributed lock (Redlock) before inserting a settlement row. The `settlements` table should have a `UNIQUE` constraint on `(merchant_id, period_start, period_end)` to make concurrent settlement attempts idempotent.

### Settling unconfirmed transactions

The WHERE clause must be strict: `status = 'CONFIRMED'`. Never include `PENDING`, `PROCESSING`, or `EXPIRED` rows — these represent payments whose final outcome is unknown.

### Fee rounding errors

Always use `Math.ceil()` for fee calculation — this ensures OrchestratePay never rounds down its own revenue. Round the net amount down (`Math.floor`) to ensure the disbursed amount is always in whole cents.

### B2B callback missing

If the `DARAJA_B2B_RESULT_URL` is not publicly accessible (e.g., dev environment), B2B calls will move to `PROCESSING` and never reach `COMPLETED`. Run with `ngrok` locally, or use the Daraja sandbox callback simulator.
