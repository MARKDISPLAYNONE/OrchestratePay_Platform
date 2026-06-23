/**
 * settlement.ts — Nightly merchant settlement job.
 *
 * Runs at 23:50 Africa/Nairobi. For each merchant with unsettled CONFIRMED
 * transactions, creates a settlement batch and dispatches the payout via the
 * merchant's registered settlement account (M-Pesa B2C or bank transfer).
 *
 * Platform fee: 1.5% of gross amount (configurable via SETTLEMENT_FEE_BPS).
 * Minimum settlement: KSh 100 (configurable via SETTLEMENT_MIN_KES).
 *
 * Uses Redlock so only one pod runs the job in a multi-replica deployment.
 */
import { db } from '../db/index'

import { logger } from '../util/logger'
import { withDistributedLock } from '../util/distributed-lock'
import { initiateB2cPayout } from '../integrations/daraja'

const FEE_BPS      = parseInt(process.env.SETTLEMENT_FEE_BPS  ?? '150')  // 1.5%
const MIN_CENTS    = parseInt(process.env.SETTLEMENT_MIN_KES   ?? '100') * 100
const LOCK_TTL_MS  = 5 * 60 * 1000  // 5 min — settlement should complete well within this

export async function runSettlementJob(): Promise<void> {
  await withDistributedLock('settlement-job', LOCK_TTL_MS, async () => {
    logger.info('Settlement job started')

    const periodEnd   = new Date()
    const periodStart = await getLastSettlementCutoff()

    // Find all merchants with unsettled CONFIRMED transactions in the period.
    const { rows: batches } = await db.query<{
      merchant_id: string
      gross_cents: string
      txn_count:   string
      txn_ids:     string[]
    }>(`
      SELECT
        t.merchant_id,
        SUM(t.amount_cents)::BIGINT  AS gross_cents,
        COUNT(t.id)::INTEGER         AS txn_count,
        ARRAY_AGG(t.id)              AS txn_ids
      FROM transactions t
      LEFT JOIN settlement_transactions st ON st.transaction_id = t.id
      WHERE t.status       = 'CONFIRMED'
        AND t.confirmed_at >= $1
        AND t.confirmed_at <  $2
        AND st.transaction_id IS NULL          -- not yet settled
      GROUP BY t.merchant_id
      HAVING SUM(t.amount_cents) >= $3
    `, [periodStart, periodEnd, MIN_CENTS])

    logger.info('Settlement batches found', { count: batches.length, period: { periodStart, periodEnd } })

    for (const batch of batches) {
      await settleMerchant({
        merchantId:  batch.merchant_id,
        grossCents:  parseInt(batch.gross_cents),
        txnCount:    parseInt(batch.txn_count),
        txnIds:      batch.txn_ids,
        periodStart,
        periodEnd,
      })
    }

    logger.info('Settlement job complete', { batches: batches.length })
  })
}

interface BatchArgs {
  merchantId:  string
  grossCents:  number
  txnCount:    number
  txnIds:      string[]
  periodStart: Date
  periodEnd:   Date
}

async function settleMerchant(args: BatchArgs): Promise<void> {
  const { merchantId, grossCents, txnCount, txnIds, periodStart, periodEnd } = args

  const feeCents = Math.round(grossCents * FEE_BPS / 10_000)
  const netCents = grossCents - feeCents

  // Look up primary settlement account.
  const { rows: accounts } = await db.query(
    `SELECT * FROM settlement_accounts
      WHERE merchant_id = $1 AND is_primary = true AND active = true
      LIMIT 1`,
    [merchantId]
  )
  const account = accounts[0] ?? null

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    // Insert settlement record.
    const { rows: [settlement] } = await client.query(
      `INSERT INTO settlements
         (merchant_id, settlement_account_id, period_start, period_end,
          gross_amount_cents, fee_cents, net_amount_cents, transaction_count,
          status, payout_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               CASE WHEN $2 IS NULL THEN 'NO_ACCOUNT' ELSE 'PENDING' END,
               $9)
       RETURNING id`,
      [
        merchantId, account?.id ?? null,
        periodStart, periodEnd,
        grossCents, feeCents, netCents, txnCount,
        account ? (account.account_type === 'MPESA' ? 'MPESA' : 'BANK') : null,
      ]
    )
    const settlementId = settlement.id

    // Link transactions to this settlement.
    if (txnIds.length > 0) {
      const vals  = txnIds.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')
      const params = txnIds.flatMap(id => [settlementId, id])
      await client.query(
        `INSERT INTO settlement_transactions (settlement_id, transaction_id) VALUES ${vals}`,
        params
      )
    }

    await client.query('COMMIT')

    // Dispatch payout outside the transaction (network call).
    if (!account) {
      logger.warn('Settlement created — no account on file', { merchantId, settlementId, netCents })
      return
    }

    if (account.account_type === 'MPESA' && account.mpesa_phone) {
      await dispatchMpesaSettlement(settlementId, merchantId, account.mpesa_phone, netCents)
    } else {
      // Bank transfer: mark PENDING for manual/automated bank processing.
      logger.info('Bank settlement queued', { settlementId, merchantId, netCents })
    }
  } catch (err: unknown) {
    await client.query('ROLLBACK')
    logger.error('Settlement batch failed', { merchantId, error: (err as Error).message })
  } finally {
    client.release()
  }
}

async function dispatchMpesaSettlement(
  settlementId: string,
  merchantId:   string,
  phone:        string,
  netCents:     number
): Promise<void> {
  try {
    const result = await initiateB2cPayout({
      refundId:       settlementId,  // reuse field as correlationId
      merchantId,
      amountCents:    netCents,
      recipientPhone: phone,
    })

    await db.query(
      `UPDATE settlements
          SET status = 'PROCESSING', b2c_request_id = $2, updated_at = NOW()
        WHERE id = $1`,
      [settlementId, result.requestId]
    )
    logger.info('Settlement M-Pesa payout dispatched', { settlementId, requestId: result.requestId })
  } catch (err: unknown) {
    await db.query(
      `UPDATE settlements
          SET status = 'FAILED', failure_reason = $2, updated_at = NOW()
        WHERE id = $1`,
      [settlementId, (err as Error).message]
    )
    logger.error('Settlement M-Pesa payout failed', { settlementId, error: (err as Error).message })
  }
}

async function getLastSettlementCutoff(): Promise<Date> {
  const { rows } = await db.query(
    `SELECT MAX(period_end) AS last_end FROM settlements`
  )
  // Default: start from 24h ago on first run (catches yesterday's transactions).
  return rows[0]?.last_end ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
}
