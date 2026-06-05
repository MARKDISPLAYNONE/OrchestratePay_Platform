---
name: orchestratepay-loyalty-crm
description: >
  Build the OrchestratePay closed-loop loyalty and CRM layer.
  Covers point accrual on payment confirmation, stamp-card mechanics,
  consumer profile management, loyalty balance API, redemption flow,
  HCE-triggered loyalty lookup, merchant-configurable reward rules,
  and the consumer-facing loyalty balance display in the wallet app.
  Use this skill for: points/stamps on tap, loyalty redemption, consumer profiles,
  repeat customer detection, merchant reward configuration, loyalty API endpoints,
  and wallet app loyalty UI.
---

# OrchestratePay — Customer Loyalty & CRM

## How loyalty integrates with the payment flow

Loyalty points are awarded on `CONFIRMED` payment — never on `PENDING` or `STK_SENT`.
The M-Pesa callback triggers both the transaction status update AND the points accrual
in a single DB transaction, so points are never awarded for a payment that didn't succeed.

```
Customer taps phone → STK Push → Customer enters PIN → CONFIRMED
                                                           ↓
                                            Award loyalty points (same DB txn)
                                                           ↓
                                            Push "You earned X points!" via WebSocket
```

## Database schema

```sql
-- Loyalty programme per merchant (each merchant configures their own rules)
CREATE TABLE loyalty_programmes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      UUID NOT NULL REFERENCES merchants(id) UNIQUE,
  programme_type   VARCHAR(16) NOT NULL CHECK (programme_type IN ('POINTS','STAMPS')),
  -- POINTS: earn 1 point per KSh N spent
  points_per_ksh   NUMERIC(10,2),    -- e.g. 1.0 = 1 point per KSh 1
  -- STAMPS: earn 1 stamp per transaction, redeem after N stamps
  stamps_for_reward INT,             -- e.g. 10 = free item after 10 stamps
  reward_description TEXT,           -- "Free chai after 10 stamps"
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consumer loyalty balance per merchant
CREATE TABLE loyalty_balances (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id    UUID NOT NULL REFERENCES consumers(id),
  merchant_id    UUID NOT NULL REFERENCES merchants(id),
  points_balance BIGINT NOT NULL DEFAULT 0,   -- integer points
  stamps_balance INT    NOT NULL DEFAULT 0,   -- integer stamps
  lifetime_spent_cents BIGINT NOT NULL DEFAULT 0,
  UNIQUE (consumer_id, merchant_id)
);

-- Ledger — append-only record of every points/stamps event
CREATE TABLE loyalty_ledger (
  id             BIGSERIAL PRIMARY KEY,
  consumer_id    UUID NOT NULL REFERENCES consumers(id),
  merchant_id    UUID NOT NULL REFERENCES merchants(id),
  transaction_id UUID REFERENCES transactions(id),
  event_type     VARCHAR(16) NOT NULL CHECK (event_type IN ('EARN','REDEEM','EXPIRE','ADJUST')),
  points_delta   BIGINT NOT NULL DEFAULT 0,
  stamps_delta   INT    NOT NULL DEFAULT 0,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Points accrual on payment confirmation

```typescript
// In mpesa-callback.ts, after updating status to CONFIRMED:
await awardLoyaltyPoints(txnId, merchantId, consumerId, amountCents, db)

async function awardLoyaltyPoints(
  txnId: string, merchantId: string, consumerId: string,
  amountCents: number, db: Pool
): Promise<void> {
  const prog = await db.query(
    'SELECT * FROM loyalty_programmes WHERE merchant_id=$1 AND active=TRUE',
    [merchantId]
  )
  if (prog.rows.length === 0) return  // merchant has no loyalty programme

  const programme = prog.rows[0]
  let pointsDelta = 0, stampsDelta = 0

  if (programme.programme_type === 'POINTS') {
    const kshSpent = amountCents / 100
    pointsDelta = Math.floor(kshSpent * programme.points_per_ksh)
  } else if (programme.programme_type === 'STAMPS') {
    stampsDelta = 1  // one stamp per transaction regardless of amount
  }

  if (pointsDelta === 0 && stampsDelta === 0) return

  // Upsert balance + append ledger in one transaction
  await db.query('BEGIN')
  try {
    await db.query(`
      INSERT INTO loyalty_balances (consumer_id, merchant_id, points_balance, stamps_balance, lifetime_spent_cents)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (consumer_id, merchant_id) DO UPDATE SET
        points_balance       = loyalty_balances.points_balance + EXCLUDED.points_balance,
        stamps_balance       = loyalty_balances.stamps_balance + EXCLUDED.stamps_balance,
        lifetime_spent_cents = loyalty_balances.lifetime_spent_cents + EXCLUDED.lifetime_spent_cents
    `, [consumerId, merchantId, pointsDelta, stampsDelta, amountCents])

    await db.query(`
      INSERT INTO loyalty_ledger (consumer_id, merchant_id, transaction_id, event_type, points_delta, stamps_delta, description)
      VALUES ($1, $2, $3, 'EARN', $4, $5, $6)
    `, [consumerId, merchantId, txnId, pointsDelta, stampsDelta,
        `Earned on KSh ${(amountCents/100).toFixed(2)} payment`])

    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK')
    // Loyalty failure MUST NOT affect the payment confirmation
    logger.error('Loyalty accrual failed', { txnId, consumerId, err })
  }
}
```

## Loyalty API endpoints

```
GET  /api/v1/loyalty/balance          — consumer's balance at this merchant (via JWT)
GET  /api/v1/merchants/me/loyalty     — merchant's programme config
POST /api/v1/merchants/me/loyalty     — create/update loyalty programme
POST /api/v1/loyalty/redeem           — redeem points/stamps
```

## Android wallet app — loyalty balance display

After a successful tap, the wallet app can display loyalty status:

```kotlin
// In ActivatePaymentActivity, after session is confirmed:
data class LoyaltyStatus(
    val programmeType: String,   // "POINTS" or "STAMPS"
    val balance: Int,
    val stampsForReward: Int?,   // null for POINTS
    val rewardDescription: String?
)

// Show: "You have 47 stamps — 3 more for a free chai!"
// Or:   "You have 2,340 points"
```

## Repeat customer detection

```typescript
// Returns true if this consumer has paid this merchant before
async function isRepeatCustomer(consumerId: string, merchantId: string): Promise<boolean> {
  const { rows } = await db.query(`
    SELECT 1 FROM loyalty_balances
    WHERE consumer_id=$1 AND merchant_id=$2 AND lifetime_spent_cents > 0
    LIMIT 1
  `, [consumerId, merchantId])
  return rows.length > 0
}

// Use in the WebSocket push after CONFIRMED:
// { type: 'PAYMENT_CONFIRMED', repeatCustomer: true, loyaltyPoints: 12 }
// POS shows: "Welcome back! +12 points"
```

## Key invariants

1. Points are only awarded on `CONFIRMED` — never on `PENDING`, `STK_SENT`, or `DECLINED`
2. Loyalty failure (DB error, programme misconfigured) never rolls back the payment
3. `loyalty_ledger` is append-only — adjustments use `ADJUST` type, never UPDATE
4. One programme per merchant — UNIQUE constraint on `loyalty_programmes(merchant_id)`
5. `POINTS` and `STAMPS` are mutually exclusive programme types per merchant
6. Redemption must check balance ≥ redemption cost before writing to ledger
