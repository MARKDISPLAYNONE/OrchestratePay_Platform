/**
 * routes/accounting.ts — Accounting integration management.
 *
 * Merchant routes (require merchant JWT):
 *   GET    /api/v1/accounting/integrations          — list connected integrations
 *   POST   /api/v1/accounting/integrations/:platform/connect  — connect (store tokens)
 *   DELETE /api/v1/accounting/integrations/:platform          — disconnect
 *   PATCH  /api/v1/accounting/integrations/:platform/settings — update account codes
 *   GET    /api/v1/accounting/gl-postings           — GL posting history
 *   POST   /api/v1/accounting/gl-postings/:id/retry — manually retry a FAILED posting
 *
 * In a full implementation the OAuth flow would redirect to the accounting platform
 * and exchange the authorization code here. For the pilot, merchants paste their
 * access_token + refresh_token from the platform's developer portal.
 */
import { Router, Request, Response } from 'express'
import { db }          from '../db/index'
import { requireAuth } from '../middleware/auth'
import { logger }      from '../util/logger'
import { runGlPostingJob } from '../jobs/gl-posting'

const SUPPORTED_PLATFORMS = ['quickbooks', 'xero', 'sage', 'wave'] as const
type Platform = typeof SUPPORTED_PLATFORMS[number]

const router = Router()
router.use(requireAuth)

// ─── GET /api/v1/accounting/integrations ─────────────────────────────────────

router.get('/integrations', async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { rows } = await db.query(
    `SELECT id, platform, status, realm_id, settings, connected_at, last_sync_at
     FROM accounting_integrations
     WHERE merchant_id = $1
     ORDER BY connected_at DESC`,
    [merchantId]
  )
  // Never return tokens to the client
  res.json({ integrations: rows })
})

// ─── POST /api/v1/accounting/integrations/:platform/connect ──────────────────

router.post('/integrations/:platform/connect', async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { platform } = req.params as { platform: string }

  if (!SUPPORTED_PLATFORMS.includes(platform as Platform)) {
    return res.status(400).json({
      error: `Unsupported platform: ${platform}`,
      supported: SUPPORTED_PLATFORMS,
    })
  }

  const { accessToken, refreshToken, tokenExpiresAt, realmId, settings } = req.body

  if (!accessToken) {
    return res.status(400).json({ error: 'accessToken is required' })
  }

  const { rows } = await db.query(
    `INSERT INTO accounting_integrations
       (merchant_id, platform, access_token, refresh_token, token_expires_at, realm_id, settings, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')
     ON CONFLICT (merchant_id, platform) DO UPDATE SET
       access_token     = EXCLUDED.access_token,
       refresh_token    = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       realm_id         = EXCLUDED.realm_id,
       settings         = COALESCE(EXCLUDED.settings, accounting_integrations.settings),
       status           = 'ACTIVE',
       updated_at       = NOW()
     RETURNING id, platform, status, connected_at`,
    [
      merchantId, platform, accessToken,
      refreshToken ?? null, tokenExpiresAt ?? null,
      realmId ?? null, settings ? JSON.stringify(settings) : '{}',
    ]
  )

  logger.info('Accounting integration connected', { merchantId, platform })
  res.status(201).json({ integration: rows[0] })
})

// ─── DELETE /api/v1/accounting/integrations/:platform ───────────────────────

router.delete('/integrations/:platform', async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { platform } = req.params

  await db.query(
    `UPDATE accounting_integrations
     SET status = 'DISCONNECTED', access_token = NULL, refresh_token = NULL, updated_at = NOW()
     WHERE merchant_id = $1 AND platform = $2`,
    [merchantId, platform]
  )

  logger.info('Accounting integration disconnected', { merchantId, platform })
  res.json({ ok: true })
})

// ─── PATCH /api/v1/accounting/integrations/:platform/settings ────────────────

router.patch('/integrations/:platform/settings', async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { platform } = req.params
  const { settings } = req.body

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings object required' })
  }

  const { rowCount } = await db.query(
    `UPDATE accounting_integrations
     SET settings = settings || $1::jsonb, updated_at = NOW()
     WHERE merchant_id = $2 AND platform = $3`,
    [JSON.stringify(settings), merchantId, platform]
  )

  if ((rowCount ?? 0) === 0) {
    return res.status(404).json({ error: 'Integration not found' })
  }

  res.json({ ok: true })
})

// ─── GET /api/v1/accounting/gl-postings ──────────────────────────────────────

router.get('/gl-postings', async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const limit  = Math.min(parseInt(req.query.limit as string) || 50, 200)
  const offset = parseInt(req.query.offset as string) || 0
  const status = req.query.status as string | undefined

  const { rows } = await db.query(
    `SELECT id, platform, transaction_id, status, external_id,
            amount_cents, currency, description, journal_date,
            attempt_count, last_error, posted_at, created_at
     FROM gl_postings
     WHERE merchant_id = $1
       ${status ? 'AND status = $4' : ''}
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    status
      ? [merchantId, limit, offset, status]
      : [merchantId, limit, offset]
  )

  res.json({ postings: rows, limit, offset })
})

// ─── POST /api/v1/accounting/gl-postings/:id/retry ───────────────────────────

router.post('/gl-postings/:id/retry', async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { id } = req.params

  const { rowCount } = await db.query(
    `UPDATE gl_postings
     SET status = 'PENDING', attempt_count = 0, last_error = NULL
     WHERE id = $1 AND merchant_id = $2 AND status = 'FAILED'`,
    [id, merchantId]
  )

  if ((rowCount ?? 0) === 0) {
    return res.status(404).json({ error: 'Failed GL posting not found' })
  }

  // Kick the job immediately (non-blocking)
  runGlPostingJob().catch(() => {})
  logger.info('GL posting manually retried', { glPostingId: id, merchantId })
  res.json({ ok: true, message: 'Retry queued' })
})

export default router
