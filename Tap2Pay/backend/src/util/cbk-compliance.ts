/**
 * util/cbk-compliance.ts — CBK (Central Bank of Kenya) transaction compliance.
 *
 * Enforces daily transaction limits by KYC tier per CBK National Payment System
 * Regulations 2014 (amended 2021).
 *
 * KYC tiers:
 *   BASIC    — phone number only; KSh 10,000/day
 *   ENHANCED — national ID + selfie; KSh 100,000/day
 *   FULL     — full KYC; no daily limit
 *
 * Fail-safe: any DB error causes the check to ALLOW (payment not blocked by a
 * compliance service outage). Errors are logged for monitoring.
 */
import { db }     from '../db/index'
import { logger } from './logger'

export type KycTier = 'BASIC' | 'ENHANCED' | 'FULL'

export interface ComplianceResult {
  allowed:      boolean
  reason?:      string
  code?:        'CBK_DAILY_LIMIT' | 'CBK_BALANCE_LIMIT' | 'CBK_KYC_REQUIRED'
  limitCents?:  number
  usedCents?:   number
}

// CBK daily limits per tier (KES cents)
export const DAILY_LIMITS: Record<KycTier, number> = {
  BASIC:    1_000_000,    // KSh 10,000
  ENHANCED: 10_000_000,   // KSh 100,000
  FULL:     Infinity,
}

export async function checkCbkCompliance(
  consumerId:  string,
  amountCents: number,
): Promise<ComplianceResult> {
  try {
    const { rows: consumerRows } = await db.query(
      `SELECT kyc_tier FROM consumers WHERE id = $1`,
      [consumerId]
    )
    if (consumerRows.length === 0) {
      return { allowed: false, reason: 'Consumer not found', code: 'CBK_KYC_REQUIRED' }
    }

    const tier  = (consumerRows[0].kyc_tier ?? 'BASIC') as KycTier
    const limit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.BASIC

    if (limit === Infinity) return { allowed: true }

    const { rows: spendRows } = await db.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::BIGINT AS daily_spent
       FROM transactions
       WHERE consumer_id = $1
         AND status = 'CONFIRMED'
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi')`,
      [consumerId]
    )

    const usedCents = parseInt(spendRows[0]?.daily_spent ?? '0')
    const remaining = limit - usedCents

    if (amountCents > remaining) {
      logger.warn('CBK daily limit would be exceeded', {
        consumerId,
        tier,
        limitCents: limit,
        usedCents,
        amountCents,
      })
      return {
        allowed:    false,
        reason:     `Daily spending limit for ${tier} KYC tier would be exceeded`,
        code:       'CBK_DAILY_LIMIT',
        limitCents: limit,
        usedCents,
      }
    }

    return { allowed: true, limitCents: limit, usedCents }

  } catch (err: any) {
    // Compliance check failures must NOT block payments
    logger.error('CBK compliance check failed — allowing payment', {
      error: err.message,
      consumerId,
    })
    return { allowed: true }
  }
}

export async function getDailySpendSummary(consumerId: string): Promise<{
  tier:           KycTier
  limitCents:     number | null
  usedCents:      number
  remainingCents: number | null
}> {
  const { rows: consumerRows } = await db.query(
    `SELECT kyc_tier FROM consumers WHERE id = $1`,
    [consumerId]
  )
  const tier  = (consumerRows[0]?.kyc_tier ?? 'BASIC') as KycTier
  const limit = DAILY_LIMITS[tier]

  const { rows: spendRows } = await db.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::BIGINT AS daily_spent
     FROM transactions
     WHERE consumer_id = $1
       AND status = 'CONFIRMED'
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi')`,
    [consumerId]
  )
  const usedCents = parseInt(spendRows[0]?.daily_spent ?? '0')

  return {
    tier,
    limitCents:     limit === Infinity ? null : limit,
    usedCents,
    remainingCents: limit === Infinity ? null : limit - usedCents,
  }
}
