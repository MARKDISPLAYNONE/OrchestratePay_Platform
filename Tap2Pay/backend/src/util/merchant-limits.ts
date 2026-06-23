/**
 * util/merchant-limits.ts — Per-merchant daily and monthly transaction limits.
 *
 * Enforced in addition to the per-consumer CBK daily limits.
 * Defaults by KYC tier (overridable per-merchant via daily_tx_limit_cents / monthly_tx_limit_cents):
 *
 *   BASIC    — KSh 100,000/day, KSh  500,000/month
 *   ENHANCED — KSh 500,000/day, KSh 5,000,000/month
 *   FULL     — unlimited
 *
 * Fail-safe: DB errors allow the payment through (never block on infra failure).
 */
import { db }     from '../db/index'
import { logger } from './logger'

const TIER_DEFAULTS: Record<string, { dailyCents: number; monthlyCents: number }> = {
  BASIC:    { dailyCents: 10_000_000,    monthlyCents:  50_000_000  },   // KSh 100K / 500K
  ENHANCED: { dailyCents: 50_000_000,    monthlyCents: 500_000_000  },   // KSh 500K / 5M
  FULL:     { dailyCents: Infinity,      monthlyCents:  Infinity    },
}

export interface MerchantLimitResult {
  allowed:     boolean
  reason?:     string
  code?:       'MERCHANT_DAILY_LIMIT' | 'MERCHANT_MONTHLY_LIMIT' | 'MERCHANT_FLAGGED'
  limitCents?: number
  usedCents?:  number
}

export async function checkMerchantLimits(
  merchantId:  string,
  amountCents: number,
): Promise<MerchantLimitResult> {
  try {
    const { rows } = await db.query(
      `SELECT kyc_tier, daily_tx_limit_cents, monthly_tx_limit_cents, sanctions_status
       FROM merchants WHERE id = $1`,
      [merchantId]
    )
    if (rows.length === 0) return { allowed: false, reason: 'Merchant not found', code: 'MERCHANT_FLAGGED' }

    const m = rows[0]

    // Block sanctioned merchants immediately
    if (m.sanctions_status === 'FLAGGED') {
      return { allowed: false, reason: 'Merchant account is under compliance review', code: 'MERCHANT_FLAGGED' }
    }

    const tier     = (m.kyc_tier ?? 'BASIC') as string
    const defaults = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.BASIC

    const dailyLimit   = m.daily_tx_limit_cents   ?? defaults.dailyCents
    const monthlyLimit = m.monthly_tx_limit_cents  ?? defaults.monthlyCents

    if (dailyLimit === Infinity && monthlyLimit === Infinity) return { allowed: true }

    // Daily spend
    const { rows: dayRows } = await db.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::BIGINT AS day_spent
       FROM transactions
       WHERE merchant_id = $1
         AND status = 'CONFIRMED'
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi')`,
      [merchantId]
    )
    const daySpent = parseInt(dayRows[0]?.day_spent ?? '0')

    if (dailyLimit !== Infinity && daySpent + amountCents > dailyLimit) {
      logger.warn('Merchant daily limit would be exceeded', { merchantId, tier, dailyLimit, daySpent, amountCents })
      return { allowed: false, reason: `Daily transaction limit for ${tier} tier exceeded`, code: 'MERCHANT_DAILY_LIMIT', limitCents: dailyLimit, usedCents: daySpent }
    }

    // Monthly spend
    if (monthlyLimit !== Infinity) {
      const { rows: monRows } = await db.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::BIGINT AS month_spent
         FROM transactions
         WHERE merchant_id = $1
           AND status = 'CONFIRMED'
           AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Africa/Nairobi')`,
        [merchantId]
      )
      const monthSpent = parseInt(monRows[0]?.month_spent ?? '0')

      if (monthSpent + amountCents > monthlyLimit) {
        logger.warn('Merchant monthly limit would be exceeded', { merchantId, tier, monthlyLimit, monthSpent, amountCents })
        return { allowed: false, reason: `Monthly transaction limit for ${tier} tier exceeded`, code: 'MERCHANT_MONTHLY_LIMIT', limitCents: monthlyLimit, usedCents: monthSpent }
      }
    }

    return { allowed: true }

  } catch (err: unknown) {
    logger.error('Merchant limit check failed — allowing payment', { merchantId, error: (err as Error).message })
    return { allowed: true }  // fail-safe: don't block on infra errors
  }
}
