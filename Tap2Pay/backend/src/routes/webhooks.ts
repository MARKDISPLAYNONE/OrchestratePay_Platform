/**
 * routes/webhooks.ts — Merchant webhook registration and delivery management.
 *
 * POST   /api/v1/webhooks              — register a new webhook endpoint
 * GET    /api/v1/webhooks              — list merchant's webhooks (no secrets)
 * DELETE /api/v1/webhooks/:id          — soft-delete (active = FALSE)
 * POST   /api/v1/webhooks/:id/test     — enqueue a ping delivery (202)
 * GET    /api/v1/webhooks/:id/deliveries — last 100 delivery attempts
 *
 * Secrets are shown ONCE at creation and never returned again.
 * Rotate a webhook by deleting it and re-creating with the same URL.
 */
import crypto from 'crypto'
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { logger } from '../util/logger'

const router = Router()

// ─── Validation schemas ───────────────────────────────────────────────────────

const SUPPORTED_EVENTS = [
  'payment.confirmed',
  'payment.failed',
  'refund.completed',
  'dispute.opened',
  'subscription.charged',
] as const

const createWebhookSchema = Joi.object({
  url: Joi.string().uri().required(),
  events: Joi.array()
    .items(Joi.string().valid(...SUPPORTED_EVENTS))
    .min(1)
    .default(['payment.confirmed', 'payment.failed']),
  name: Joi.string().max(100).required(),
})

// ─── POST /api/v1/webhooks ────────────────────────────────────────────────────
// Register a new webhook. The secret is returned ONLY here.

router.post('/', requireAuth, validate(createWebhookSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { url, events, name } = req.body

  const id     = uuidv4()
  const secret = crypto.randomBytes(32).toString('hex')

  try {
    const { rows } = await db.query(
      `INSERT INTO merchant_webhooks (id, merchant_id, url, secret, events, name, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, url, events, name, active, created_at AS "createdAt"`,
      [id, merchantId, url, secret, events, name]
    )

    const webhook = rows[0]
    logger.info('Webhook registered', { merchantId, webhookId: id, url })

    return res.status(201).json({
      id:        webhook.id,
      url:       webhook.url,
      events:    webhook.events,
      name:      webhook.name,
      secret,                           // only time the secret is shown
      active:    webhook.active,
      createdAt: webhook.createdAt,
    })
  } catch (err: any) {
    logger.error('Failed to register webhook', { merchantId, error: err.message })
    return res.status(500).json({ error: 'Failed to register webhook' })
  }
})

// ─── GET /api/v1/webhooks ─────────────────────────────────────────────────────
// List webhooks for the authenticated merchant. Secrets are never returned.
// Includes 24 h delivery stats per webhook.

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub

  try {
    const { rows } = await db.query(
      `SELECT
         w.id,
         w.url,
         w.events,
         w.name,
         w.active,
         w.created_at        AS "createdAt",
         COUNT(d.id) FILTER (WHERE d.status = 'DELIVERED' AND d.created_at > NOW() - INTERVAL '24 hours') AS "deliveredCount",
         COUNT(d.id) FILTER (WHERE d.status = 'FAILED'    AND d.created_at > NOW() - INTERVAL '24 hours') AS "failedCount"
       FROM merchant_webhooks w
       LEFT JOIN webhook_deliveries d ON d.webhook_id = w.id
       WHERE w.merchant_id = $1 AND w.active = TRUE
       GROUP BY w.id
       ORDER BY w.created_at DESC`,
      [merchantId]
    )

    return res.json({
      webhooks: rows.map(r => ({
        id:             r.id,
        url:            r.url,
        events:         r.events,
        name:           r.name,
        active:         r.active,
        createdAt:      r.createdAt,
        stats24h: {
          delivered: Number(r.deliveredCount),
          failed:    Number(r.failedCount),
        },
      })),
    })
  } catch (err: any) {
    logger.error('Failed to list webhooks', { merchantId, error: err.message })
    return res.status(500).json({ error: 'Failed to list webhooks' })
  }
})

// ─── DELETE /api/v1/webhooks/:id ─────────────────────────────────────────────
// Soft-delete: sets active = FALSE. Returns 404 if not found or wrong merchant.

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { id }     = req.params

  try {
    const { rowCount } = await db.query(
      `UPDATE merchant_webhooks
       SET active = FALSE
       WHERE id = $1 AND merchant_id = $2 AND active = TRUE`,
      [id, merchantId]
    )

    if (!rowCount || rowCount === 0) {
      return res.status(404).json({ error: 'Webhook not found' })
    }

    logger.info('Webhook deactivated', { merchantId, webhookId: id })
    return res.status(200).json({ id, active: false })
  } catch (err: any) {
    logger.error('Failed to delete webhook', { merchantId, webhookId: id, error: err.message })
    return res.status(500).json({ error: 'Failed to delete webhook' })
  }
})

// ─── POST /api/v1/webhooks/:id/test ──────────────────────────────────────────
// Enqueue a ping event delivery for manual testing.

router.post('/:id/test', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { id }     = req.params

  try {
    // Verify this webhook belongs to the merchant and is active
    const { rows } = await db.query(
      `SELECT id FROM merchant_webhooks
       WHERE id = $1 AND merchant_id = $2 AND active = TRUE`,
      [id, merchantId]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' })
    }

    const payload = {
      event:     'ping',
      timestamp: new Date().toISOString(),
    }

    await db.query(
      `INSERT INTO webhook_deliveries (webhook_id, event, payload, status, attempt)
       VALUES ($1, 'ping', $2, 'PENDING', 0)`,
      [id, JSON.stringify(payload)]
    )

    logger.info('Webhook test ping enqueued', { merchantId, webhookId: id })
    return res.status(202).json({ queued: true })
  } catch (err: any) {
    logger.error('Failed to enqueue webhook test', { merchantId, webhookId: id, error: err.message })
    return res.status(500).json({ error: 'Failed to enqueue test delivery' })
  }
})

// ─── GET /api/v1/webhooks/:id/deliveries ─────────────────────────────────────
// List last 100 delivery attempts for a webhook, newest first.

router.get('/:id/deliveries', requireAuth, async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { id }     = req.params

  try {
    // Ownership check
    const { rows: wRows } = await db.query(
      `SELECT id FROM merchant_webhooks
       WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId]
    )

    if (wRows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' })
    }

    const { rows } = await db.query(
      `SELECT
         id,
         event,
         status,
         attempt,
         last_error   AS "lastError",
         delivered_at AS "deliveredAt",
         created_at   AS "createdAt"
       FROM webhook_deliveries
       WHERE webhook_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id]
    )

    return res.json({ deliveries: rows })
  } catch (err: any) {
    logger.error('Failed to list webhook deliveries', { merchantId, webhookId: id, error: err.message })
    return res.status(500).json({ error: 'Failed to list deliveries' })
  }
})

export default router
