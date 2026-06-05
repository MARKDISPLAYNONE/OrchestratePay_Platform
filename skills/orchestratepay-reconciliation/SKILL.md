---
name: orchestratepay-reconciliation
description: >
  Build and extend OrchestratePay's financial reconciliation layer.
  Covers the autonomous reconciliation worker (Node.js cron), Daraja STK Query,
  distributed ledger cross-referencing against M-Pesa statements, dual-write
  idempotency guards, and the state machine's EXPIRED/FAILED terminal transitions.
  Use this skill for: missed callback recovery, zombie transaction cleanup,
  M-Pesa statement reconciliation, duplicate charge detection, financial accuracy
  guarantees, nightly settlement reports, and reconciliation job scheduling.
---

# OrchestratePay — Financial Reconciliation & Integrity

## The reconciliation problem

In production, approximately 2–5% of M-Pesa STK Push callbacks never arrive. Causes:
- Safaricom retry budget exhausted (they retry 3× with 30s backoff)
- Our server was briefly unreachable during their delivery window
- The 4G link between Safaricom and our server dropped mid-callback

A transaction in `STK_SENT` with no callback is a **zombie**: we don't know if the consumer was charged. The reconciliation worker is the self-healing mechanism.

## Transaction eligibility window

```typescript
const MIN_AGE_MINUTES = 5    // don't query too soon — callback may still arrive
const MAX_AGE_MINUTES = 90   // after 90 min, callback will never arrive → EXPIRED

function isEligibleForReconciliation(ageMinutes: number): boolean {
  return ageMinutes >= MIN_AGE_MINUTES && ageMinutes < MAX_AGE_MINUTES
}
```

| Age | Action |
|-----|--------|
| < 5 min | Skip — callback may still be in-flight |
| 5–90 min | Query Daraja STK Query API |
| ≥ 90 min | Mark EXPIRED (no callback will ever arrive) |

## Reconciliation worker — cron schedule

```typescript
// src/jobs/reconciliation.ts
import cron from 'node-cron'

// Runs every 5 minutes — balances freshness vs. Daraja API quota
cron.schedule('*/5 * * * *', async () => {
  const stuckTxns = await db.query(`
    SELECT id, checkout_request_id, amount_cents, created_at
    FROM transactions
    WHERE status IN ('PENDING', 'STK_SENT')
      AND created_at < NOW() - INTERVAL '5 minutes'
      AND created_at > NOW() - INTERVAL '90 minutes'
    ORDER BY created_at ASC
    LIMIT 50                    -- cap per run to stay within Daraja rate limits
  `)

  for (const txn of stuckTxns.rows) {
    await reconcileTransaction(txn)
    await delay(500)             // 500ms between queries — respect Daraja rate limits
  }
})
```

## Daraja STK Query result mapping

```typescript
async function reconcileTransaction(txn: StuckTxn): Promise<void> {
  const queryResult = await stkQuery(txn.checkout_request_id)

  const newStatus = mapQueryResultToStatus(queryResult.ResultCode)
  if (newStatus === 'SKIP') return  // Daraja says still processing

  // Use the same idempotency guard as the callback handler —
  // if the callback arrived between our query start and this UPDATE, the
  // WHERE clause protects us: rowsAffected=0 if status already changed.
  const result = await db.query(`
    UPDATE transactions
    SET status = $1, updated_at = NOW()
    WHERE id = $2
      AND status IN ('PENDING', 'STK_SENT')   -- forward-only guard
    RETURNING id
  `, [newStatus, txn.id])

  if (result.rowCount > 0) {
    await db.query(
      `INSERT INTO daraja_callback_log (transaction_id, source, result_code, raw_payload, retain_until)
       VALUES ($1, 'RECONCILIATION', $2, $3, NOW() + INTERVAL '7 years')`,
      [txn.id, queryResult.ResultCode, JSON.stringify(queryResult)]
    )
  }
}

function mapQueryResultToStatus(resultCode: number): string {
  if (resultCode === 0)    return 'CONFIRMED'
  if (resultCode === 500)  return 'SKIP'        // Daraja: still processing
  if (resultCode === -1)   return 'SKIP'        // Our query failed — try next run
  return 'DECLINED'                              // All other codes → consumer declined/error
}
```

## M-Pesa statement cross-reference (Level 2 reconciliation)

Beyond STK Query, you can run a nightly reconciliation against the M-Pesa C2B statement:

```typescript
// Nightly at 02:00 Nairobi time — after Safaricom closes the business day
cron.schedule('0 23 * * *', async () => {  // 23:00 UTC = 02:00 EAT
  // 1. Pull yesterday's M-Pesa statement via Daraja Account Balance or
  //    Business Activity Statement API (requires special Daraja tier)
  const statement = await fetchMpesaStatement(yesterday())

  // 2. Cross-reference against our CONFIRMED transactions
  for (const entry of statement.entries) {
    const txn = await db.query(
      'SELECT * FROM transactions WHERE mpesa_ref = $1', [entry.mpesaRef])

    if (txn.rows.length === 0) {
      // M-Pesa recorded a payment we have no record of → CRITICAL ALERT
      await alertOpsTeam('UNMATCHED_MPESA_CREDIT', entry)
    } else if (txn.rows[0].amount_cents !== toCents(entry.amount)) {
      // Amount mismatch between our DB and M-Pesa ledger → CRITICAL ALERT
      await alertOpsTeam('AMOUNT_MISMATCH', { txn: txn.rows[0], entry })
    }
  }
})
```

## Distributed write safety (callback + reconciliation race)

Both the callback handler and the reconciliation worker write to the same row.
The `WHERE status IN ('PENDING','STK_SENT')` clause is the serialisation point:

```
Callback wins:         reconciliation UPDATE → rowsAffected=0 → silently dropped
Reconciliation wins:   late callback UPDATE  → rowsAffected=0 → silently dropped
Conflicting outcomes:  first writer's status is permanently preserved
```

**Never** use `UPDATE ... SET status=$1 WHERE id=$2` without the status guard.
This is the single most dangerous bug pattern in the codebase.

## EXPIRED transition (reconciliation cleanup)

```typescript
// Run in the same cron job, before the STK Query loop
await db.query(`
  UPDATE transactions
  SET status = 'EXPIRED', updated_at = NOW()
  WHERE status IN ('PENDING', 'STK_SENT')
    AND created_at < NOW() - INTERVAL '90 minutes'
`)
```

EXPIRED is a terminal state. No callback, no reconciliation query, no STK retry
can change an EXPIRED transaction. The consumer either got charged (and we'll
see it in the nightly statement) or did not. The merchant re-initiates if needed.

## Z-Report and settlement

The Z-Report endpoint (`GET /api/v1/merchants/me/z-report?date=YYYY-MM-DD`) queries
`status IN ('CONFIRMED','DECLINED','FAILED')` in Africa/Nairobi time. Only `CONFIRMED`
transactions contribute to revenue. `EXPIRED` and `PENDING` are excluded because
their financial outcome is not yet determined.

## CBK 7-year retention

Every reconciliation action must be logged in `daraja_callback_log` with
`retain_until = NOW() + INTERVAL '7 years'`. This is a CBK hard requirement.
The reconciliation job is a financial actor — it must leave an audit trail.

## Key invariants (never violate)

1. Write DB record BEFORE calling Daraja (write-ahead pattern)
2. `WHERE status IN ('PENDING','STK_SENT')` on every UPDATE — never omit this
3. Every status change logs to `daraja_callback_log` with `source='RECONCILIATION'`
4. Skip result code 500 and -1 — do not mark DECLINED prematurely
5. EXPIRED is permanent — no code path may transition out of EXPIRED
6. 50-row cap per reconciliation run — Daraja STK Query has rate limits
