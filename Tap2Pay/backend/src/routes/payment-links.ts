/**
 * routes/payment-links.ts — Shareable payment link generation and redemption.
 *
 * POST /api/v1/payment-links
 *   Merchant creates a shareable payment link. Returns a short URL.
 *   Token stored in Redis: payment:link:{16-char token}, TTL 86400s (24h).
 *
 * GET /api/v1/payment-links/:token
 *   Resolves the token — returns merchant info + amount for consumer app deep-link.
 *
 * POST /api/v1/payment-links/:token/pay
 *   Consumer redeems the link. Writes a transaction record with source='PAYMENT_LINK'.
 *   Single-use links are invalidated immediately on first call (race-safe via Redis DEL).
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 } from 'uuid'
import { redis }       from '../db/redis'
import { db }          from '../db/index'
import { requireAuth } from '../middleware/auth'
import { validate }    from '../middleware/validate'
import { logger }      from '../util/logger'

const router = Router()

const LINK_TTL_S = 86_400  // 24 hours

const createLinkSchema = Joi.object({
  amountCents: Joi.number().integer().min(100).max(100_000_000).required(),
  description: Joi.string().max(100).optional(),
  singleUse:   Joi.boolean().default(true),
})

const payLinkSchema = Joi.object({
  consumerPhone:  Joi.string().pattern(/^254[0-9]{9}$/).required()
    .messages({ 'string.pattern.base': 'Phone must be in 254XXXXXXXXX format' }),
  idempotencyKey: Joi.string().length(32).hex().required(),
})

// POST /api/v1/payment-links
router.post('/', requireAuth, validate(createLinkSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { amountCents, description, singleUse } = req.body

  const token   = uuidv4().replace(/-/g, '').slice(0, 16)
  const key     = `payment:link:${token}`
  const expireAt = new Date(Date.now() + LINK_TTL_S * 1000).toISOString()

  const payload = {
    token,
    merchantId,
    amountCents,
    description:  description ?? null,
    singleUse:    singleUse ?? true,
    createdAt:    new Date().toISOString(),
    expiresAt:    expireAt,
  }

  await redis.setex(key, LINK_TTL_S, JSON.stringify(payload))

  const baseUrl = process.env.PAYMENT_LINK_BASE_URL ?? 'https://pay.orchestratepay.co.ke'
  const url     = `${baseUrl}/pay/${token}`

  logger.info('Payment link created', { merchantId, token, amountCents })
  res.status(201).json({ token, url, expiresAt: expireAt })
})

// GET /api/v1/payment-links/:token
router.get('/:token', async (req: Request, res: Response) => {
  const { token } = req.params
  const key = `payment:link:${token}`

  const raw = await redis.get(key)
  if (!raw) {
    return res.status(404).json({ error: 'Payment link not found or expired' })
  }

  const payload = JSON.parse(raw)

  const { rows } = await db.query(
    `SELECT name FROM merchants WHERE id = $1`,
    [payload.merchantId]
  )
  const merchantName = rows[0]?.name ?? 'Unknown Merchant'

  res.json({
    token:        payload.token,
    merchantId:   payload.merchantId,
    merchantName,
    amountCents:  payload.amountCents,
    description:  payload.description,
    expiresAt:    payload.expiresAt,
  })
})

// POST /api/v1/payment-links/:token/pay
router.post('/:token/pay', validate(payLinkSchema), async (req: Request, res: Response) => {
  const { token }                       = req.params
  const { consumerPhone, idempotencyKey } = req.body
  const key                             = `payment:link:${token}`

  // Idempotency check first — return cached result if key seen before
  const idempKey  = `idempotency:link:${idempotencyKey}`
  const cached    = await redis.get(idempKey)
  if (cached) return res.json(JSON.parse(cached))

  const raw = await redis.get(key)
  if (!raw) {
    return res.status(404).json({ error: 'Payment link not found or expired' })
  }

  const payload = JSON.parse(raw)

  // For single-use links, delete atomically before writing the transaction.
  // If DEL returns 0 (key already deleted by a concurrent request), reject.
  if (payload.singleUse) {
    const deleted = await redis.del(key)
    if (deleted === 0) {
      return res.status(409).json({ error: 'Payment link already redeemed' })
    }
  }

  const txnId = uuidv4()

  try {
    await db.query(
      `INSERT INTO transactions
         (id, merchant_id, amount_cents, consumer_phone, status, source, idempotency_key)
       VALUES ($1, $2, $3, $4, 'PENDING', 'PAYMENT_LINK', $5)`,
      [txnId, payload.merchantId, payload.amountCents, consumerPhone, idempotencyKey]
    )

    const result = { txnId, status: 'PENDING', amountCents: payload.amountCents }

    await redis.setex(idempKey, LINK_TTL_S, JSON.stringify(result))

    logger.info('Payment link redeemed', {
      token,
      txnId,
      merchantId: payload.merchantId,
    })
    res.status(202).json(result)

  } catch (err: unknown) {
    // Restore the link if the DB write failed (and link was single-use)
    if (payload.singleUse) {
      await redis.setex(key, 60, raw).catch(() => {})
    }
    logger.error('Payment link pay failed', { error: (err as Error).message, token })
    res.status(500).json({ error: 'Failed to initiate payment' })
  }
})

export default router
