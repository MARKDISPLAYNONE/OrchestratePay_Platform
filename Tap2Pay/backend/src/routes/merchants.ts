/**
 * routes/merchants.ts — merchant account management.
 *
 * POST /api/v1/merchants             — register a new merchant (admin only)
 * GET  /api/v1/merchants/me          — get authenticated merchant's profile
 * PUT  /api/v1/merchants/me          — update merchant's own profile/settings
 * GET  /api/v1/merchants/me/z-report — daily transaction summary (Z-Report)
 *
 * ADMIN REGISTRATION:
 * OrchestratePay is a B2B platform — merchants are registered by our team,
 * not via public self-service. This endpoint requires the X-Admin-Secret
 * header matching the ADMIN_SECRET environment variable.
 * In production, this call originates from our internal onboarding tool.
 */
import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import { db } from '../db/index'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from './admin'
import { validate } from '../middleware/validate'
import { logger } from '../util/logger'
import Joi from 'joi'

const router = Router()

// ─── Schemas ─────────────────────────────────────────────────────────────────

const registerSchema = Joi.object({
  name:             Joi.string().min(2).max(100).required(),
  email:            Joi.string().email().required(),
  password:         Joi.string().min(8).required(),
  phone:            Joi.string().min(9).max(15).required(),
  mpesaShortcode:   Joi.string().optional().allow('', null),
  mpesaAccountRef:  Joi.string().max(20).optional().allow('', null),
  // KRA PIN — required by CBK for official receipts (format: Pxxxxxxxxxx or Axxxxxxxxxx)
  kraPin:           Joi.string().min(10).max(15).optional().allow('', null),
})

const updateProfileSchema = Joi.object({
  name:             Joi.string().min(2).max(100).optional(),
  phone:            Joi.string().min(9).max(15).optional(),
  mpesaShortcode:   Joi.string().optional().allow('', null),
  mpesaAccountRef:  Joi.string().max(20).optional().allow('', null),
  kraPin:           Joi.string().min(10).max(15).optional().allow('', null),
}).min(1)  // at least one field must be provided

// ─── POST /api/v1/merchants ───────────────────────────────────────────────────

router.post('/', requireAdmin, validate(registerSchema), async (req: Request, res: Response) => {
  const { name, email, password, phone, mpesaShortcode, mpesaAccountRef, kraPin } = req.body

  // Check email uniqueness before hashing (cheap check first)
  const exists = await db.query(
    'SELECT id FROM merchants WHERE email = $1',
    [email.toLowerCase()]
  )
  if (exists.rows.length > 0) {
    return res.status(409).json({ error: 'A merchant with this email already exists' })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const result = await db.query(
    `INSERT INTO merchants (name, email, password_hash, phone, mpesa_shortcode, mpesa_account_ref, kra_pin)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, email, phone, kra_pin, active, created_at`,
    [name, email.toLowerCase(), passwordHash, phone, mpesaShortcode ?? null, mpesaAccountRef ?? null, kraPin ?? null]
  )

  const merchant = result.rows[0]

  logger.info('Merchant registered', { merchantId: merchant.id, email: merchant.email, requestId: req.id })

  await db.query(
    `INSERT INTO server_audit_log (event, entity_type, entity_id, detail, ip_address)
     VALUES ('MERCHANT_REGISTERED', 'merchant', $1, $2, $3)`,
    [merchant.id, JSON.stringify({ email: merchant.email }), req.ip]
  )

  res.status(201).json(merchant)
})

// ─── GET /api/v1/merchants/me ─────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT id, name, phone, email, mpesa_shortcode, mpesa_account_ref,
            kra_pin, active, device_id IS NOT NULL AS has_active_session, created_at
     FROM merchants WHERE id = $1`,
    [req.merchant!.sub]
  )
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Merchant not found' })
  }
  res.json(result.rows[0])
})

// ─── PUT /api/v1/merchants/me ─────────────────────────────────────────────────

router.put('/me', requireAuth, validate(updateProfileSchema), async (req: Request, res: Response) => {
  const { name, phone, mpesaShortcode, mpesaAccountRef, kraPin } = req.body

  // Build a dynamic SET clause from only the fields that were provided
  const updates: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (name !== undefined)            { updates.push(`name = $${idx++}`);              values.push(name) }
  if (phone !== undefined)           { updates.push(`phone = $${idx++}`);             values.push(phone) }
  if (mpesaShortcode !== undefined)  { updates.push(`mpesa_shortcode = $${idx++}`);   values.push(mpesaShortcode) }
  if (mpesaAccountRef !== undefined) { updates.push(`mpesa_account_ref = $${idx++}`); values.push(mpesaAccountRef) }
  if (kraPin !== undefined)          { updates.push(`kra_pin = $${idx++}`);           values.push(kraPin) }

  values.push(req.merchant!.sub)  // WHERE id = $N

  const result = await db.query(
    `UPDATE merchants SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${idx}
     RETURNING id, name, phone, email, mpesa_shortcode, mpesa_account_ref, kra_pin, active, updated_at`,
    values
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Merchant not found' })
  }

  logger.info('Merchant profile updated', { merchantId: req.merchant!.sub, fields: Object.keys(req.body), requestId: req.id })

  res.json(result.rows[0])
})

// ─── GET /api/v1/merchants/me/z-report ───────────────────────────────────────
//
// Returns the daily Z-Report: transaction totals for a single calendar day.
//
// Query param: ?date=YYYY-MM-DD (defaults to today in Africa/Nairobi timezone)
//
// Response:
//   {
//     date:          "2026-05-25",
//     merchantName:  "Mama Ngina Butchery",
//     transactions: {
//       confirmed: { count: 12, totalCents: 450000 },
//       declined:  { count:  2, totalCents:       0 },
//       failed:    { count:  1, totalCents:       0 },
//       total:     { count: 15, totalCents: 450000 }
//     },
//     firstTxnAt: "2026-05-25T07:14:23.000Z",  // null if no transactions
//     lastTxnAt:  "2026-05-25T18:52:01.000Z",
//     generatedAt: "2026-05-25T19:00:00.000Z"
//   }
//
// Why Africa/Nairobi: Merchants think in Nairobi time. A transaction at 11:55 PM
// must appear on today's Z-Report, not tomorrow's UTC-shifted report.

router.get('/me/z-report', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub

  // Parse ?date= or default to today in Africa/Nairobi (UTC+3)
  const rawDate = req.query.date as string | undefined
  let reportDate: string

  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    reportDate = rawDate
  } else {
    // Current date in Nairobi time (UTC+3)
    const now = new Date()
    const nairobiOffset = 3 * 60  // minutes
    const nairobiMs = now.getTime() + (nairobiOffset - now.getTimezoneOffset()) * 60_000
    reportDate = new Date(nairobiMs).toISOString().slice(0, 10)
  }

  try {
    // All counts and sums in a single query — cheaper than multiple round-trips.
    // We cast created_at to Africa/Nairobi time so day boundaries match merchant expectations.
    const result = await db.query<{
      status: string
      count: string
      total_cents: string
      first_txn: string | null
      last_txn: string | null
      merchant_name: string
    }>(
      `SELECT
         t.status,
         COUNT(*)::text                                          AS count,
         COALESCE(SUM(t.amount_cents), 0)::text                 AS total_cents,
         MIN(t.created_at)::text                                AS first_txn,
         MAX(t.created_at)::text                                AS last_txn,
         m.name                                                 AS merchant_name
       FROM transactions t
       JOIN merchants m ON m.id = t.merchant_id
       WHERE t.merchant_id = $1
         AND (t.created_at AT TIME ZONE 'Africa/Nairobi')::date = $2::date
         AND t.status IN ('CONFIRMED','DECLINED','FAILED')
       GROUP BY t.status, m.name`,
      [merchantId, reportDate]
    )

    const merchantName = result.rows[0]?.merchant_name ?? ''

    // Fold rows into typed buckets
    const buckets: Record<string, { count: number; totalCents: number }> = {
      confirmed: { count: 0, totalCents: 0 },
      declined:  { count: 0, totalCents: 0 },
      failed:    { count: 0, totalCents: 0 },
    }

    let firstTxnAt: string | null = null
    let lastTxnAt:  string | null = null

    for (const row of result.rows) {
      const key = row.status.toLowerCase() as keyof typeof buckets
      if (key in buckets) {
        buckets[key].count      = parseInt(row.count, 10)
        buckets[key].totalCents = parseInt(row.total_cents, 10)
      }
      if (!firstTxnAt || row.first_txn! < firstTxnAt) firstTxnAt = row.first_txn
      if (!lastTxnAt  || row.last_txn!  > lastTxnAt)  lastTxnAt  = row.last_txn
    }

    const total = {
      count:      buckets.confirmed.count + buckets.declined.count + buckets.failed.count,
      totalCents: buckets.confirmed.totalCents,  // only confirmed revenue counts in the total
    }

    logger.info('Z-Report generated', { merchantId, reportDate, totalConfirmed: total.totalCents, requestId: req.id })

    res.json({
      date:         reportDate,
      merchantName,
      transactions: { ...buckets, total },
      firstTxnAt,
      lastTxnAt,
      generatedAt:  new Date().toISOString(),
    })
  } catch (err) {
    logger.error('Z-Report query failed', { merchantId, reportDate, error: (err as Error).message })
    res.status(500).json({ error: 'Failed to generate Z-Report' })
  }
})

// ─── GET /api/v1/merchants/me/analytics/weekly ────────────────────────────────
router.get('/me/analytics/weekly', requireAuth, async (req: Request, res: Response) => {
  const weeks  = Math.min(parseInt(req.query.weeks as string) || 4, 52)
  const { rows } = await db.query(`
    SELECT
      date_trunc('week', hour_nairobi)::date AS week_start,
      SUM(revenue_cents)::bigint             AS revenue_cents,
      SUM(confirmed_count)::int              AS confirmed_count,
      SUM(declined_count)::int               AS declined_count
    FROM mv_hourly_revenue
    WHERE merchant_id = $1
      AND hour_nairobi >= NOW() - ($2 || ' weeks')::interval
    GROUP BY week_start
    ORDER BY week_start ASC
  `, [req.merchant!.sub, weeks])
  res.json(rows)
})

// ─── GET /api/v1/merchants/me/analytics/peak-hours ───────────────────────────
router.get('/me/analytics/peak-hours', requireAuth, async (req: Request, res: Response) => {
  const { rows } = await db.query(`
    SELECT
      EXTRACT(DOW  FROM hour_nairobi)::int AS day_of_week,
      EXTRACT(HOUR FROM hour_nairobi)::int AS hour_of_day,
      AVG(revenue_cents)::bigint           AS avg_revenue_cents,
      AVG(confirmed_count)::int            AS avg_transactions
    FROM mv_hourly_revenue
    WHERE merchant_id = $1
      AND hour_nairobi >= NOW() - INTERVAL '90 days'
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `, [req.merchant!.sub])
  res.json(rows)
})

// ─── GET /api/v1/merchants/me/analytics/sources ──────────────────────────────
router.get('/me/analytics/sources', requireAuth, async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query.days as string) || 30, 365)
  const { rows } = await db.query(`
    SELECT
      source,
      COUNT(*)::int              AS count,
      SUM(amount_cents)::bigint  AS revenue_cents
    FROM transactions
    WHERE merchant_id = $1
      AND status = 'CONFIRMED'
      AND created_at >= NOW() - ($2 || ' days')::interval
    GROUP BY source
  `, [req.merchant!.sub, days])
  res.json(rows)
})

export default router
