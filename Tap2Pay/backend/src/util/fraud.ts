/**
 * util/fraud.ts — Rule-based fraud scoring engine.
 *
 * Scores a proposed transaction 0–100 before the STK Push is dispatched.
 * Called by all consumer-facing payment routes.
 *
 * Thresholds:
 *   0–69   ALLOW  — proceed normally
 *   70–89  REVIEW — log, proceed, flag for ops review
 *   90–100 DECLINE — reject with 402
 *
 * Scoring rules:
 *   Rule 1: Consumer velocity  — too many transactions in the time window
 *   Rule 2: Amount deviation   — transaction far above merchant's average
 *   Rule 3: High-value debut   — large first transaction from an unknown consumer
 *
 * All rules catch their own errors — a DB/Redis failure in one rule does not
 * fail the payment or prevent the other rules from running.
 *
 * Tunable via env vars (see constants below).
 */
import { db }     from '../db/index'
import { redis }  from '../db/redis'
import { logger } from './logger'

export interface FraudInput {
  consumerId:     string
  merchantId:     string
  amountCents:    number
  source:         string
  idempotencyKey: string
}

export interface FraudResult {
  score:    number
  decision: 'ALLOW' | 'REVIEW' | 'DECLINE'
  reasons:  string[]
}

const VELOCITY_WINDOW_S       = parseInt(process.env.FRAUD_VELOCITY_WINDOW_S  ?? '3600')
const VELOCITY_MAX_TXNS       = parseInt(process.env.FRAUD_VELOCITY_MAX_TXNS  ?? '10')
const AMOUNT_DEVIATION_FACTOR = parseFloat(process.env.FRAUD_AMOUNT_FACTOR    ?? '5.0')
const HIGH_AMOUNT_KES_CENTS   = parseInt(process.env.FRAUD_HIGH_AMOUNT_CENTS  ?? '500000')
const REVIEW_THRESHOLD        = 70
const DECLINE_THRESHOLD       = 90

export async function scoreFraud(input: FraudInput): Promise<FraudResult> {
  const reasons: string[] = []
  let score = 0

  // ── Rule 1: Consumer velocity ─────────────────────────────────────────────
  const velocityKey = `fraud:vel:${input.consumerId}`
  try {
    const count = await redis.incr(velocityKey)
    if (count === 1) await redis.expire(velocityKey, VELOCITY_WINDOW_S)

    if (count > VELOCITY_MAX_TXNS) {
      const excess       = count - VELOCITY_MAX_TXNS
      const velocityScore = Math.min(40, excess * 8)
      score += velocityScore
      reasons.push(`velocity:${count}_txns_in_${VELOCITY_WINDOW_S}s`)
    }
  } catch (err: any) {
    logger.warn('Fraud velocity check skipped (Redis error)', { error: err.message })
  }

  // ── Rule 2: Amount deviation from merchant 30-day average ────────────────
  try {
    const { rows } = await db.query(
      `SELECT AVG(amount_cents)::FLOAT AS avg_amount
       FROM transactions
       WHERE merchant_id = $1
         AND status = 'CONFIRMED'
         AND created_at > NOW() - INTERVAL '30 days'`,
      [input.merchantId]
    )
    const avg = rows[0]?.avg_amount
    if (avg && avg > 0) {
      const factor = input.amountCents / avg
      if (factor > AMOUNT_DEVIATION_FACTOR) {
        const deviationScore = Math.min(30, Math.floor((factor - AMOUNT_DEVIATION_FACTOR) * 5))
        score += deviationScore
        reasons.push(`amount_deviation:${factor.toFixed(1)}x_merchant_avg`)
      }
    }
  } catch (err: any) {
    logger.warn('Fraud amount deviation check skipped (DB error)', { error: err.message })
  }

  // ── Rule 3: High absolute amount on first-time consumer ──────────────────
  if (input.amountCents > HIGH_AMOUNT_KES_CENTS) {
    try {
      const { rows } = await db.query(
        `SELECT COUNT(*) AS txn_count
         FROM transactions
         WHERE consumer_id = $1 AND status = 'CONFIRMED'`,
        [input.consumerId]
      )
      const txnCount = parseInt(rows[0]?.txn_count ?? '0')
      if (txnCount === 0) {
        score += 25
        reasons.push(`high_amount_first_transaction:${input.amountCents}cents`)
      }
    } catch (err: any) {
      logger.warn('Fraud first-transaction check skipped (DB error)', { error: err.message })
    }
  }

  const decision: FraudResult['decision'] =
    score >= DECLINE_THRESHOLD ? 'DECLINE' :
    score >= REVIEW_THRESHOLD  ? 'REVIEW'  : 'ALLOW'

  if (decision !== 'ALLOW') {
    logger.warn('Fraud score elevated', {
      consumerId: input.consumerId,
      merchantId: input.merchantId,
      score,
      decision,
      reasons,
    })
  }

  return { score, decision, reasons }
}
