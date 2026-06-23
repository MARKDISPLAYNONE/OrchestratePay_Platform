/**
 * jobs/reconciliation.ts — finds and resolves stuck PENDING transactions.
 *
 * WHY THIS EXISTS:
 * M-Pesa callbacks can fail to arrive for many reasons:
 *   - Network hiccup between Safaricom and our server
 *   - Our server was briefly down during the callback
 *   - Safaricom's callback system had a delay
 *   - Our callback URL changed (misconfiguration)
 *
 * Without reconciliation, those transactions stay PENDING forever.
 * The Android app's polling loop times out after ~37.5 seconds, but the
 * DB record remains PENDING. That means:
 *   - Merchant sees a "timeout" but consumer was actually charged
 *   - Merchant might ask the consumer to pay again (double charge)
 *   - CBK audit shows unresolved PENDING transactions (compliance issue)
 *
 * HOW IT WORKS:
 *   1. Find transactions stuck in PENDING for more than 5 minutes
 *   2. Query Daraja's STK Query API for each one
 *   3. Update the DB based on Daraja's response
 *   4. Notify via Redis pub/sub (in case the app is still polling)
 *
 * SCHEDULE: Every 5 minutes (cron: "* /5 * * * *")
 * We wait 5 minutes before checking because:
 *   - Most callbacks arrive within 60 seconds
 *   - We want to give the normal callback path time to work
 *   - Daraja's query API also has rate limits — don't hammer it
 *
 * EXPIRY: Transactions older than 90 minutes are expired.
 * After 90 minutes, the consumer's STK Push window has definitely closed
 * and no callback will ever arrive.
 */
import { db } from '../db/index'
import { redis } from '../db/redis'
import { stkQuery } from '../integrations/daraja'
import { logger } from '../util/logger'
import { withDistributedLock } from '../util/distributed-lock'

const RECONCILE_AFTER_MINUTES = 5    // only check transactions older than this
const EXPIRE_AFTER_MINUTES = 90      // expire transactions older than this

export async function runReconciliation(): Promise<void> {
  // Distributed lock: TTL = 4 min 50 s (slightly less than the 5-min schedule).
  // If one pod holds the lock, other pods skip this run entirely — no duplicate
  // Daraja STK Queries, no double-confirm notifications.
  const ran = await withDistributedLock('reconciliation', 290, () => _reconcile())
  if (!ran) {
    logger.info('Reconciliation: skipped (another pod is running it)')
  }
}

async function _reconcile(): Promise<void> {
  logger.info('Reconciliation job starting')
  const started = Date.now()
  let processed = 0, confirmed = 0, declined = 0, expired = 0

  try {
    // ─── Step 1: Find stuck PENDING transactions ───────────────────────────────
    // "stuck" = PENDING + has a checkout_request_id (STK Push was sent) + older than 5 min
    const stuckResult = await db.query(
      `SELECT id, checkout_request_id, idempotency_key, amount_cents, created_at
       FROM transactions
       WHERE status IN ('PENDING', 'STK_SENT')
         AND checkout_request_id IS NOT NULL
         AND created_at < NOW() - ($1 || ' minutes')::interval
         AND created_at > NOW() - ($2 || ' minutes')::interval
       ORDER BY created_at ASC
       LIMIT 100`,
      [RECONCILE_AFTER_MINUTES, EXPIRE_AFTER_MINUTES]
    )

    const stuck = stuckResult.rows
    logger.info('Reconciliation: found stuck transactions', { count: stuck.length })

    // ─── Step 2: Query Daraja for each one ────────────────────────────────────
    for (const txn of stuck) {
      try {
        processed++
        const queryResult = await stkQuery(txn.checkout_request_id)

        if (queryResult.resultCode === 500 || queryResult.resultCode === -1) {
          // 500 = Daraja says "still processing" — leave as PENDING
          // -1 = our query failed — leave as PENDING, try next run
          logger.debug('Reconciliation: transaction still processing', {
            txnId: txn.id,
            code: queryResult.resultCode
          })
          continue
        }

        if (queryResult.resultCode === 0) {
          // Confirmed — missed callback
          await db.query(
            `UPDATE transactions
             SET status = 'CONFIRMED', mpesa_result_code = 0,
                 mpesa_result_desc = 'Reconciled', confirmed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [txn.id]
          )
          confirmed++

          // Notify if the Android app is still polling
          await redis.publish(`txn:confirmed:${txn.id}`, JSON.stringify({
            status: 'CONFIRMED', txnId: txn.id, amountCents: txn.amount_cents
          }))

          // Update idempotency cache
          await redis.setex(`idempotency:${txn.idempotency_key}`, 3600, JSON.stringify({
            status: 'CONFIRMED', txnId: txn.id, amountCents: txn.amount_cents
          }))

          logger.info('Reconciliation: confirmed transaction', { txnId: txn.id })

        } else {
          // Failed — declined by consumer or timed out
          await db.query(
            `UPDATE transactions
             SET status = 'DECLINED', mpesa_result_code = $1,
                 mpesa_result_desc = $2, updated_at = NOW()
             WHERE id = $3`,
            [queryResult.resultCode, queryResult.resultDesc, txn.id]
          )
          declined++

          await redis.publish(`txn:confirmed:${txn.id}`, JSON.stringify({
            status: 'DECLINED', txnId: txn.id, code: queryResult.resultCode
          }))

          logger.info('Reconciliation: declined transaction', {
            txnId: txn.id, code: queryResult.resultCode
          })
        }

      } catch (txnErr: unknown) {
        logger.error('Reconciliation: error processing transaction', {
          txnId: txn.id, error: (txnErr as Error).message
        })
        // Continue to next transaction — don't let one error stop the whole job
      }

      // Small delay between Daraja queries to avoid rate limiting
      await sleep(200)
    }

    // ─── Step 3: Expire very old PENDING transactions ─────────────────────────
    const expireResult = await db.query(
      `UPDATE transactions
       SET status = 'EXPIRED', mpesa_result_desc = 'Expired by reconciliation job',
           updated_at = NOW()
       WHERE status IN ('PENDING', 'STK_SENT')
         AND created_at < NOW() - ($1 || ' minutes')::interval
       RETURNING id`,
      [EXPIRE_AFTER_MINUTES]
    )
    expired = expireResult.rowCount ?? 0

    if (expired > 0) {
      logger.warn('Reconciliation: expired old PENDING transactions', { count: expired })
    }

    const durationMs = Date.now() - started
    logger.info('Reconciliation job completed', {
      processed, confirmed, declined, expired, durationMs
    })

    // Write reconciliation summary to audit log
    await db.query(
      `INSERT INTO server_audit_log (event, detail)
       VALUES ('RECONCILIATION_RUN', $1)`,
      [JSON.stringify({ processed, confirmed, declined, expired, durationMs })]
    )

  } catch (err: unknown) {
    logger.error('Reconciliation job failed', { error: (err as Error).message })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
