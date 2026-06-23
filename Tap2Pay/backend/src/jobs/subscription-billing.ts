/**
 * jobs/subscription-billing.ts — fires STK Push for due subscription renewals.
 *
 * TWO RESPONSIBILITIES:
 *
 * 1. runSubscriptionBillingJob()
 *    Runs on a schedule (e.g. every minute via node-cron).
 *    Finds ACTIVE enrollments whose next_billing_at is in the past,
 *    fires an M-Pesa STK Push to the consumer's phone, writes a PENDING
 *    transaction row, and advances next_billing_at by the plan interval.
 *
 *    Processes up to 100 enrollments per run to keep each run short.
 *    Errors are logged per-enrollment and never abort the full batch —
 *    a STK Push failure for one consumer must not skip billing the next.
 *
 * 2. runTrialExpiry()
 *    Runs separately (e.g. every hour).
 *    Transitions TRIAL enrollments whose trial_ends_at is in the past
 *    to ACTIVE, setting next_billing_at = NOW() so they are picked up
 *    by the next billing run.
 *
 * Interval → days mapping (matches subscription_plans.interval CHECK constraint):
 *   DAILY: 1, WEEKLY: 7, MONTHLY: 30, QUARTERLY: 90, ANNUALLY: 365
 */
import { db }      from '../db/index'
import { stkPush } from '../integrations/daraja'
import { logger }  from '../util/logger'
import { v4 as uuidv4 } from 'uuid'

// Maps plan interval to calendar days for simple, predictable billing cycles.
// MONTHLY = 30 days (not calendar month) to keep arithmetic straightforward.
const INTERVAL_DAYS: Record<string, number> = {
  DAILY:     1,
  WEEKLY:    7,
  MONTHLY:   30,
  QUARTERLY: 90,
  ANNUALLY:  365,
}

// ─────────────────────────────────────────────────────────────────────────────
// runSubscriptionBillingJob
// ─────────────────────────────────────────────────────────────────────────────

export async function runSubscriptionBillingJob(): Promise<void> {
  logger.info('Subscription billing job starting')
  const started = Date.now()
  let processed = 0, succeeded = 0, failed = 0

  try {
    // Fetch ACTIVE enrollments that are past their next billing date.
    // JOIN subscription_plans to get amount, interval, and merchant_id.
    const { rows: dueEnrollments } = await db.query(
      `SELECT
         e.id            AS enrollment_id,
         e.consumer_phone,
         e.next_billing_at,
         p.id            AS plan_id,
         p.merchant_id,
         p.amount_cents,
         p.interval,
         p.name          AS plan_name
       FROM subscriber_enrollments e
       JOIN subscription_plans p ON p.id = e.plan_id
       WHERE e.status = 'ACTIVE'
         AND e.next_billing_at <= NOW()
       ORDER BY e.next_billing_at ASC
       LIMIT 100`,
      []
    )

    logger.info('Subscription billing: due enrollments found', { count: dueEnrollments.length })

    for (const enrollment of dueEnrollments) {
      try {
        processed++

        const callbackBase = process.env.DARAJA_CALLBACK_BASE_URL ?? process.env.DARAJA_CALLBACK_URL ?? ''
        const callbackUrl  = `${callbackBase}/api/v1/mpesa-callback`

        // Fire STK Push to consumer's phone
        const pushResult = await stkPush({
          phoneNumber:  enrollment.consumer_phone,
          amount:       Math.ceil(enrollment.amount_cents / 100),  // cents → KSh
          accountRef:   enrollment.plan_name.slice(0, 12),
          description:  'Subscription',
          callbackUrl,
        })

        if (!pushResult.success) {
          logger.warn('Subscription billing: STK Push failed', {
            enrollmentId: enrollment.enrollment_id,
            phone:        maskPhone(enrollment.consumer_phone),
            error:        pushResult.errorMessage,
          })
          failed++
          // Advance next_billing_at even on failure so we don't retry immediately
          // and hammer a consumer whose phone is off. Next attempt is next cycle.
          await advanceNextBilling(enrollment.enrollment_id, enrollment.interval)
          continue
        }

        // Write a PENDING transaction row so reconciliation can track it
        const txnId = uuidv4()
        await db.query(
          `INSERT INTO transactions
             (id, merchant_id, amount_cents, consumer_phone, status, source, idempotency_key)
           VALUES ($1, $2, $3, $4, 'PENDING', 'QR_CODE', $5)`,
          [
            txnId,
            enrollment.merchant_id,
            enrollment.amount_cents,
            enrollment.consumer_phone,
            uuidv4().replace(/-/g, ''),  // idempotency key — unique per billing attempt
          ]
        )

        // Advance the billing date
        await advanceNextBilling(enrollment.enrollment_id, enrollment.interval)

        succeeded++
        logger.info('Subscription billing: STK Push sent', {
          enrollmentId: enrollment.enrollment_id,
          txnId,
          phone:        maskPhone(enrollment.consumer_phone),
          amountCents:  enrollment.amount_cents,
        })
      } catch (enrollmentErr: unknown) {
        // Per-enrollment error: log and continue to next subscriber
        failed++
        logger.error('Subscription billing: error processing enrollment', {
          enrollmentId: enrollment.enrollment_id,
          error:        (enrollmentErr as Error).message,
        })
      }
    }

    const durationMs = Date.now() - started
    logger.info('Subscription billing job completed', {
      processed, succeeded, failed, durationMs,
    })
  } catch (err: unknown) {
    logger.error('Subscription billing job failed', { error: (err as Error).message })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runTrialExpiry — TRIAL → ACTIVE transition
// ─────────────────────────────────────────────────────────────────────────────

export async function runTrialExpiry(): Promise<void> {
  logger.info('Trial expiry job starting')

  try {
    const { rowCount } = await db.query(
      `UPDATE subscriber_enrollments
       SET status = 'ACTIVE',
           next_billing_at = NOW()
       WHERE status = 'TRIAL'
         AND trial_ends_at <= NOW()`,
      []
    )

    const count = rowCount ?? 0
    if (count > 0) {
      logger.info('Trial expiry: transitioned TRIAL enrollments to ACTIVE', { count })
    } else {
      logger.info('Trial expiry: no expired trials found')
    }
  } catch (err: unknown) {
    logger.error('Trial expiry job failed', { error: (err as Error).message })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function advanceNextBilling(enrollmentId: string, interval: string): Promise<void> {
  const days = INTERVAL_DAYS[interval] ?? 30
  await db.query(
    `UPDATE subscriber_enrollments
     SET next_billing_at = next_billing_at + ($1 || ' days')::interval
     WHERE id = $2`,
    [days, enrollmentId]
  )
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return '****'
  return phone.slice(0, 3) + '***' + phone.slice(-4)
}
