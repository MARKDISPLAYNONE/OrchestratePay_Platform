/**
 * routes/subscriptions.ts — Recurring subscription plans and consumer enrollment.
 *
 * Merchant endpoints (requireAuth — merchant JWT):
 *   POST   /api/v1/subscriptions/plans            Create a billing plan
 *   GET    /api/v1/subscriptions/plans            List merchant's active plans + subscriber count
 *   DELETE /api/v1/subscriptions/plans/:id        Soft-delete a plan (blocks if active enrollments)
 *   GET    /api/v1/subscriptions/plans/:id/enrollments  View enrollments for a plan
 *
 * Public consumer endpoints (no auth):
 *   POST   /api/v1/subscriptions/enroll           Consumer self-enrolls in a plan
 *   DELETE /api/v1/subscriptions/enroll/:enrollmentId  Consumer cancels enrollment
 *
 * Billing is handled by the subscription-billing job (src/jobs/subscription-billing.ts),
 * which fires STK Push to enrolled consumers on their next_billing_at schedule.
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { db }          from '../db/index'
import { requireAuth } from '../middleware/auth'
import { validate }    from '../middleware/validate'
import { logger }      from '../util/logger'

const router = Router()

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const createPlanSchema = Joi.object({
  name:         Joi.string().max(100).required(),
  amountCents:  Joi.number().integer().min(100).max(1_000_000).required(),
  interval:     Joi.string()
    .valid('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY')
    .required(),
  trialDays:    Joi.number().integer().min(0).max(90).default(0),
})

const enrollSchema = Joi.object({
  planId:        Joi.string().uuid().required(),
  consumerPhone: Joi.string().pattern(/^254[0-9]{9}$/).required()
    .messages({ 'string.pattern.base': 'Phone must be in 254XXXXXXXXX format' }),
})

const cancelEnrollmentSchema = Joi.object({
  consumerPhone: Joi.string().pattern(/^254[0-9]{9}$/).required()
    .messages({ 'string.pattern.base': 'Phone must be in 254XXXXXXXXX format' }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * maskPhone — show first 3 digits (254) and last 4 digits.
 * 254700123456 → 254***3456
 */
function maskPhone(phone: string): string {
  if (phone.length < 7) return '****'
  return phone.slice(0, 3) + '***' + phone.slice(-4)
}

/**
 * calcNextBillingAt — given an interval and an optional trial offset,
 * compute the first real billing date. During trial the returned date is
 * NOW() + trialDays so billing fires only after the trial ends.
 */
function calcNextBillingAt(interval: string, trialDays: number): Date {
  const base = new Date()
  if (trialDays > 0) {
    // Next billing at = end of trial
    base.setDate(base.getDate() + trialDays)
    return base
  }
  return addInterval(base, interval)
}

function addInterval(from: Date, interval: string): Date {
  const d = new Date(from)
  switch (interval) {
    case 'DAILY':     d.setDate(d.getDate() + 1);     break
    case 'WEEKLY':    d.setDate(d.getDate() + 7);     break
    case 'MONTHLY':   d.setDate(d.getDate() + 30);    break
    case 'QUARTERLY': d.setDate(d.getDate() + 90);    break
    case 'ANNUALLY':  d.setDate(d.getDate() + 365);   break
  }
  return d
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/plans  — merchant creates a billing plan
// ─────────────────────────────────────────────────────────────────────────────

router.post('/plans', requireAuth, validate(createPlanSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { name, amountCents, interval, trialDays } = req.body
  const id = uuidv4()

  try {
    const { rows } = await db.query(
      `INSERT INTO subscription_plans
         (id, merchant_id, name, amount_cents, interval, trial_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, merchant_id, name, amount_cents, interval, trial_days, active, created_at`,
      [id, merchantId, name, amountCents, interval, trialDays]
    )
    const plan = rows[0]

    logger.info('Subscription plan created', { merchantId, planId: id, interval })

    res.status(201).json({
      id:          plan.id,
      merchantId:  plan.merchant_id,
      name:        plan.name,
      amountCents: plan.amount_cents,
      interval:    plan.interval,
      trialDays:   plan.trial_days,
      active:      plan.active,
      createdAt:   plan.created_at,
    })
  } catch (err: unknown) {
    logger.error('Failed to create subscription plan', { error: (err as Error).message, merchantId })
    res.status(500).json({ error: 'Failed to create subscription plan' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/subscriptions/plans  — list merchant's active plans + subscriber count
// ─────────────────────────────────────────────────────────────────────────────

router.get('/plans', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub

  try {
    const { rows } = await db.query(
      `SELECT
         p.id,
         p.name,
         p.amount_cents,
         p.interval,
         p.trial_days,
         p.active,
         p.created_at,
         COUNT(e.id) FILTER (WHERE e.status = 'ACTIVE') AS subscriber_count
       FROM subscription_plans p
       LEFT JOIN subscriber_enrollments e ON e.plan_id = p.id
       WHERE p.merchant_id = $1 AND p.active = TRUE
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [merchantId]
    )

    res.json({
      plans: rows.map(r => ({
        id:              r.id,
        name:            r.name,
        amountCents:     r.amount_cents,
        interval:        r.interval,
        trialDays:       r.trial_days,
        active:          r.active,
        subscriberCount: parseInt(r.subscriber_count, 10),
        createdAt:       r.created_at,
      })),
    })
  } catch (err: unknown) {
    logger.error('Failed to list subscription plans', { error: (err as Error).message, merchantId })
    res.status(500).json({ error: 'Failed to list subscription plans' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/subscriptions/plans/:id  — soft-delete a plan
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/plans/:id', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const planId     = req.params.id

  try {
    // Verify plan belongs to this merchant
    const { rows: planRows } = await db.query(
      `SELECT id FROM subscription_plans WHERE id = $1 AND merchant_id = $2 AND active = TRUE`,
      [planId, merchantId]
    )
    if (planRows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' })
    }

    // Block deletion if there are active enrollments
    const { rows: enrollRows } = await db.query(
      `SELECT COUNT(*) AS cnt FROM subscriber_enrollments
       WHERE plan_id = $1 AND status = 'ACTIVE'`,
      [planId]
    )
    if (parseInt(enrollRows[0].cnt, 10) > 0) {
      return res.status(409).json({
        error: 'Cannot delete plan with active subscribers',
        activeSubscribers: parseInt(enrollRows[0].cnt, 10),
      })
    }

    await db.query(
      `UPDATE subscription_plans SET active = FALSE WHERE id = $1`,
      [planId]
    )

    logger.info('Subscription plan soft-deleted', { merchantId, planId })
    res.json({ deleted: true, planId })
  } catch (err: unknown) {
    logger.error('Failed to delete subscription plan', { error: (err as Error).message, planId })
    res.status(500).json({ error: 'Failed to delete subscription plan' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/subscriptions/enroll  — public: consumer self-enrolls in a plan
// ─────────────────────────────────────────────────────────────────────────────

router.post('/enroll', validate(enrollSchema), async (req: Request, res: Response) => {
  const { planId, consumerPhone } = req.body
  const enrollmentId = uuidv4()

  try {
    // Verify plan exists and is active
    const { rows: planRows } = await db.query(
      `SELECT id, interval, trial_days FROM subscription_plans WHERE id = $1 AND active = TRUE`,
      [planId]
    )
    if (planRows.length === 0) {
      return res.status(404).json({ error: 'Plan not found or no longer active' })
    }

    const plan      = planRows[0]
    const trialDays = plan.trial_days as number
    const interval  = plan.interval as string

    const status      = trialDays > 0 ? 'TRIAL' : 'ACTIVE'
    const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null
    const nextBilling = calcNextBillingAt(interval, trialDays)

    await db.query(
      `INSERT INTO subscriber_enrollments
         (id, plan_id, consumer_phone, status, next_billing_at, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [enrollmentId, planId, consumerPhone, status, nextBilling, trialEndsAt]
    )

    logger.info('Consumer enrolled in subscription plan', {
      planId,
      phone: maskPhone(consumerPhone),
      status,
    })

    res.status(201).json({
      enrollmentId,
      planId,
      status,
      nextBillingAt: nextBilling.toISOString(),
      ...(trialEndsAt ? { trialEndsAt: trialEndsAt.toISOString() } : {}),
    })
  } catch (err: unknown) {
    // Unique constraint on (plan_id, consumer_phone) — already enrolled
    if ((err as NodeJS.ErrnoException).code === '23505') {
      return res.status(409).json({ error: 'Phone number is already enrolled in this plan' })
    }
    logger.error('Failed to enroll subscriber', { error: (err as Error).message, planId })
    res.status(500).json({ error: 'Failed to enroll in plan' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/subscriptions/enroll/:enrollmentId  — public: consumer cancels
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/enroll/:enrollmentId', validate(cancelEnrollmentSchema), async (req: Request, res: Response) => {
  const { enrollmentId } = req.params
  const { consumerPhone } = req.body

  try {
    // Verify enrollment exists and phone matches (consumer owns their own enrollment)
    const { rows } = await db.query(
      `SELECT id, status FROM subscriber_enrollments
       WHERE id = $1 AND consumer_phone = $2`,
      [enrollmentId, consumerPhone]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Enrollment not found or phone does not match' })
    }
    if (rows[0].status === 'CANCELLED') {
      return res.status(409).json({ error: 'Enrollment already cancelled' })
    }

    await db.query(
      `UPDATE subscriber_enrollments
       SET status = 'CANCELLED', cancelled_at = NOW()
       WHERE id = $1`,
      [enrollmentId]
    )

    logger.info('Subscription enrollment cancelled', {
      enrollmentId,
      phone: maskPhone(consumerPhone),
    })

    res.json({ cancelled: true })
  } catch (err: unknown) {
    logger.error('Failed to cancel enrollment', { error: (err as Error).message, enrollmentId })
    res.status(500).json({ error: 'Failed to cancel enrollment' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/subscriptions/plans/:id/enrollments  — merchant views enrollments
// ─────────────────────────────────────────────────────────────────────────────

router.get('/plans/:id/enrollments', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const planId     = req.params.id

  try {
    // Verify plan belongs to this merchant
    const { rows: planRows } = await db.query(
      `SELECT id FROM subscription_plans WHERE id = $1 AND merchant_id = $2`,
      [planId, merchantId]
    )
    if (planRows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' })
    }

    const { rows } = await db.query(
      `SELECT id, consumer_phone, status, next_billing_at, enrolled_at
       FROM subscriber_enrollments
       WHERE plan_id = $1
       ORDER BY enrolled_at DESC`,
      [planId]
    )

    res.json({
      enrollments: rows.map(r => ({
        id:            r.id,
        consumerPhone: maskPhone(r.consumer_phone),
        status:        r.status,
        nextBillingAt: r.next_billing_at,
        enrolledAt:    r.enrolled_at,
      })),
    })
  } catch (err: unknown) {
    logger.error('Failed to list enrollments', { error: (err as Error).message, planId })
    res.status(500).json({ error: 'Failed to list enrollments' })
  }
})

export default router
export { maskPhone, addInterval, calcNextBillingAt }
