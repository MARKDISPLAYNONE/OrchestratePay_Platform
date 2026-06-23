/**
 * routes/admin.ts — internal monitoring and operations endpoints.
 *
 * All routes require the X-Admin-Secret header. These are NOT exposed to terminals
 * or consumers — they're for the OrchestratePay operations team.
 *
 * GET /api/v1/admin/stats
 *   STK Push success/failure/timeout rates, volume metrics, circuit breaker state.
 *   The primary tool recommended by the assessment for tracking payment health
 *   before deploying to production.
 *
 * GET /api/v1/admin/pending
 *   Lists transactions currently stuck in PENDING — useful for on-call engineers
 *   to spot an outage before the reconciliation job runs.
 *
 * GET /api/v1/admin/circuit
 *   Current state of the Daraja API circuit breaker (CLOSED / OPEN / HALF_OPEN).
 */
import { Router, Request, Response, NextFunction } from 'express'
import { db } from '../db/index'
import { redis } from '../db/redis'
import { logger } from '../util/logger'
import { getDarajaCircuitStatus } from '../integrations/daraja'
import { writeAuditLog } from '../util/audit'

const router = Router()

// ─── Admin guard ──────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-admin-secret']
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    logger.warn('Unauthorised admin endpoint access', { ip: req.ip, path: req.path })
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

router.use(requireAdmin)

// ─── GET /api/v1/admin/stats ──────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // ── All-time summary ───────────────────────────────────────────────────────
    const allTime = await db.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')         AS confirmed,
        COUNT(*) FILTER (WHERE status = 'DECLINED')          AS declined,
        COUNT(*) FILTER (WHERE status = 'EXPIRED')           AS expired,
        COUNT(*) FILTER (WHERE status = 'FAILED')            AS failed,
        COUNT(*) FILTER (WHERE status = 'PENDING')           AS pending
      FROM transactions
    `)

    // ── Last 24 hours ─────────────────────────────────────────────────────────
    const last24h = await db.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')         AS confirmed,
        COUNT(*) FILTER (WHERE status = 'DECLINED')          AS declined,
        COUNT(*) FILTER (WHERE status = 'EXPIRED')           AS expired,
        COUNT(*) FILTER (WHERE status = 'FAILED')            AS failed,
        COUNT(*) FILTER (WHERE status = 'PENDING')           AS pending
      FROM transactions
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `)

    // ── Last 7 days ───────────────────────────────────────────────────────────
    const last7d = await db.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')         AS confirmed,
        COUNT(*) FILTER (WHERE status = 'DECLINED')          AS declined,
        COUNT(*) FILTER (WHERE status = 'EXPIRED')           AS expired,
        COUNT(*) FILTER (WHERE status = 'FAILED')            AS failed,
        COUNT(*) FILTER (WHERE status = 'PENDING')           AS pending
      FROM transactions
      WHERE created_at > NOW() - INTERVAL '7 days'
    `)

    // ── Timing — average ms from creation to confirmation ─────────────────────
    // Only considers transactions that were eventually confirmed
    const timing = await db.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at)) * 1000))::BIGINT AS avg_confirm_ms,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
          EXTRACT(EPOCH FROM (confirmed_at - created_at)) * 1000))::BIGINT         AS median_confirm_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY
          EXTRACT(EPOCH FROM (confirmed_at - created_at)) * 1000))::BIGINT         AS p95_confirm_ms
      FROM transactions
      WHERE status = 'CONFIRMED'
        AND confirmed_at IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
    `)

    // ── Per-hour volume for the last 24h (for sparkline charts) ───────────────
    const hourly = await db.query(`
      SELECT
        DATE_TRUNC('hour', created_at)                       AS hour,
        COUNT(*)                                             AS total,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')         AS confirmed
      FROM transactions
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY 1
      ORDER BY 1 ASC
    `)

    // ── Platform totals ───────────────────────────────────────────────────────
    const merchantCount = await db.query(`
      SELECT COUNT(*) AS count FROM merchants WHERE approval_status = 'APPROVED'
    `)
    const consumerCount = await db.query(`
      SELECT COUNT(*) AS count FROM consumers WHERE active = true
    `)

    // ── Redis health ──────────────────────────────────────────────────────────
    let redisOk = false
    try {
      await redis.ping()
      redisOk = true
    } catch { /* redis down */ }

    // ── Compute rates ─────────────────────────────────────────────────────────
    const d24 = last24h.rows[0]
    const total24 = parseInt(d24.total) || 0
    const confirmed24 = parseInt(d24.confirmed) || 0
    const expired24 = parseInt(d24.expired) || 0
    const failed24 = parseInt(d24.failed) || 0

    const successRate = total24 > 0 ? +((confirmed24 / total24) * 100).toFixed(1) : null
    const timeoutRate = total24 > 0 ? +(((expired24 + failed24) / total24) * 100).toFixed(1) : null

    res.json({
      generatedAt: new Date().toISOString(),
      allTime: toInts(allTime.rows[0]),
      last24h: {
        ...toInts(d24),
        successRate,
        timeoutRate
      },
      last7d: toInts(last7d.rows[0]),
      timing: {
        avgConfirmMs:    timing.rows[0].avg_confirm_ms    ? parseInt(timing.rows[0].avg_confirm_ms)    : null,
        medianConfirmMs: timing.rows[0].median_confirm_ms ? parseInt(timing.rows[0].median_confirm_ms) : null,
        p95ConfirmMs:    timing.rows[0].p95_confirm_ms    ? parseInt(timing.rows[0].p95_confirm_ms)    : null,
        note: 'Based on CONFIRMED transactions in the last 7 days'
      },
      hourly: hourly.rows.map(r => ({
        hour:      r.hour,
        total:     parseInt(r.total),
        confirmed: parseInt(r.confirmed)
      })),
      merchants:  { total: parseInt(merchantCount.rows[0].count) || 0 },
      consumers:  { total: parseInt(consumerCount.rows[0].count) || 0 },
      infrastructure: {
        redis:          redisOk ? 'ok' : 'down',
        darajaCircuit:  getDarajaCircuitStatus()
      }
    })

  } catch (err: unknown) {
    logger.error('Admin stats query failed', { error: (err as Error).message })
    res.status(500).json({ error: 'Stats query failed' })
  }
})

// ─── GET /api/v1/admin/pending ────────────────────────────────────────────────

router.get('/pending', async (_req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT
        t.id, t.amount_cents, t.created_at,
        EXTRACT(EPOCH FROM (NOW() - t.created_at))::INT AS age_seconds,
        m.name  AS merchant_name,
        t.checkout_request_id IS NOT NULL AS stk_sent
      FROM transactions t
      JOIN merchants m ON t.merchant_id = m.id
      WHERE t.status = 'PENDING'
      ORDER BY t.created_at ASC
      LIMIT 200
    `)

    res.json({
      count: result.rowCount,
      transactions: result.rows,
      note: 'Transactions pending > 300s will be picked up by the next reconciliation run'
    })
  } catch (err: unknown) {
    res.status(500).json({ error: 'Query failed' })
  }
})

// ─── GET /api/v1/admin/circuit ────────────────────────────────────────────────

router.get('/circuit', (_req: Request, res: Response) => {
  res.json({
    daraja: getDarajaCircuitStatus(),
    description: 'CLOSED = healthy, OPEN = Daraja unreachable, HALF_OPEN = probing after cooldown'
  })
})

// ─── GET /api/v1/admin/merchants ──────────────────────────────────────────────

router.get('/merchants', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT
        m.id, m.name, m.email, m.phone,
        m.business_reg_number, m.mpesa_shortcode,
        m.created_at, m.approval_status, m.active,
        EXISTS(
          SELECT 1 FROM devices d
          WHERE d.merchant_id = m.id
            AND d.last_seen_at > NOW() - INTERVAL '5 minutes'
        ) AS live
      FROM merchants m
      WHERE m.approval_status <> 'PENDING_REVIEW'
      ORDER BY m.name ASC
    `)
    res.json({ merchants: rows })
  } catch (err: unknown) {
    logger.error('Admin merchants query failed', { error: (err as Error).message })
    res.status(500).json({ error: 'Query failed' })
  }
})

// ─── GET /api/v1/admin/consumers ──────────────────────────────────────────────

router.get('/consumers', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT
        c.id, c.phone, c.email, c.display_name, c.active, c.created_at,
        COUNT(t.id)::INT AS transaction_count
      FROM consumers c
      LEFT JOIN transactions t ON t.consumer_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 500
    `)
    res.json({ consumers: rows })
  } catch (err: unknown) {
    logger.error('Admin consumers query failed', { error: (err as Error).message })
    res.status(500).json({ error: 'Query failed' })
  }
})

// ─── AML FLAG MANAGEMENT ──────────────────────────────────────────────────────

// GET /api/v1/admin/aml/flags  — list open AML flags (default: OPEN only)
router.get('/aml/flags', async (req: Request, res: Response) => {
  const status = (req.query.status as string) ?? 'OPEN'
  try {
    const { rows } = await db.query(
      `SELECT f.id, f.flag_type, f.status, f.details, f.created_at, f.reviewed_at, f.reviewed_by,
              m.name AS merchant_name, m.email AS merchant_email,
              m.sanctions_status, m.aml_risk_level
       FROM aml_flags f
       LEFT JOIN merchants m ON m.id = f.merchant_id
       WHERE ($1 = 'ALL' OR f.status = $1)
       ORDER BY f.created_at DESC
       LIMIT 100`,
      [status.toUpperCase()]
    )
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to fetch AML flags' })
  }
})

// PATCH /api/v1/admin/aml/flags/:id  — update flag status
router.patch('/aml/flags/:id', async (req: Request, res: Response) => {
  const { status, reviewedBy, notes } = req.body
  if (!['REVIEWED', 'CLEARED', 'REPORTED_TO_FIU'].includes(status)) {
    return res.status(400).json({ error: 'status must be REVIEWED, CLEARED, or REPORTED_TO_FIU' })
  }
  try {
    const { rows } = await db.query(
      `UPDATE aml_flags
          SET status = $2, reviewed_at = NOW(), reviewed_by = $3,
              details = details || $4::jsonb
        WHERE id = $1
        RETURNING id, status, reviewed_at, reviewed_by`,
      [req.params.id, status, reviewedBy ?? 'admin', JSON.stringify({ adminNotes: notes })]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Flag not found' })

    // If cleared, update merchant sanctions_status back to CLEAR
    if (status === 'CLEARED') {
      const { rows: [flag] } = await db.query(
        `SELECT merchant_id FROM aml_flags WHERE id = $1`,
        [req.params.id]
      )
      if (flag?.merchant_id) {
        // Only clear if no other OPEN flags remain
        const { rows: [openCount] } = await db.query(
          `SELECT COUNT(*) AS cnt FROM aml_flags WHERE merchant_id = $1 AND status = 'OPEN' AND id != $2`,
          [flag.merchant_id, req.params.id]
        )
        if (parseInt(openCount?.cnt ?? '0') === 0) {
          await db.query(
            `UPDATE merchants SET sanctions_status = 'CLEAR' WHERE id = $1`,
            [flag.merchant_id]
          )
        }
      }
    }

    await writeAuditLog({
      event: 'ADMIN_ACTION',
      detail: { action: 'aml_flag_updated', flagId: req.params.id, status, reviewedBy, notes },
      ip: req.ip,
    })
    res.json(rows[0])
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to update AML flag' })
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInts(row: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, parseInt(v) || 0])
  )
}

export default router
