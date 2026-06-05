/**
 * routes/consumers.ts — Consumer portal API endpoints.
 *
 * Public (no auth):
 * GET  /api/v1/consumers/pay/:merchantId        — merchant info for QR payment page
 *
 * Require CONSUMER JWT (issued by /auth/consumer/login):
 * GET  /api/v1/consumers/me                     — profile
 * PUT  /api/v1/consumers/me                     — update display_name, sms_opt_in
 * GET  /api/v1/consumers/me/transactions        — transaction history (across all merchants)
 * GET  /api/v1/consumers/me/loyalty             — loyalty balances across all merchants
 * POST /api/v1/consumers/pay/:merchantId        — consumer-initiated QR payment (source=QR_CODE)
 * GET  /api/v1/consumers/transactions/:txnId/status — poll payment status (used by QR web page)
 */
import { Router, Request, Response } from 'express'
import Joi from 'joi'
import { v4 as uuidv4 }   from 'uuid'
import { db }              from '../db/index'
import { redis }           from '../db/redis'
import { stkPush }         from '../integrations/daraja'
import { requireAuth, requireConsumerAuth } from '../middleware/auth'
import { validate, p2pPaySchema } from '../middleware/validate'
import { convertToKes, isSupportedCurrency } from '../util/fx'
import { logger }          from '../util/logger'

const router = Router()

// ─── PUBLIC: no auth required ────────────────────────────────────────────────
// This route MUST be defined before router.use(requireConsumerAuth) so it is
// accessible to unauthenticated consumers loading the QR payment page.

router.get('/pay/:merchantId', async (req: Request, res: Response) => {
  const { merchantId } = req.params

  const { rows } = await db.query(
    `SELECT id, name, approval_status, active FROM merchants WHERE id = $1`,
    [merchantId]
  )

  if (rows.length === 0 || !rows[0].active) {
    return res.status(404).json({ error: 'Merchant not found' })
  }

  if (rows[0].approval_status !== 'APPROVED') {
    return res.status(403).json({ error: 'Merchant is not accepting payments' })
  }

  res.json({ merchant: { id: rows[0].id, name: rows[0].name } })
})

// ─── MERCHANT AUTH: look up a consumer by their self-written tag ID ──────────
// Called by the merchant Android app and merchant web dashboard after reading
// a consumer-written NFC tag (https://orchestratepay.co.ke/c/{consumerId}).
// Returns display name + masked phone so the merchant can confirm who they're charging.

router.get('/c/:consumerId', requireAuth, async (req: Request, res: Response) => {
  const { consumerId } = req.params

  const { rows } = await db.query(
    `SELECT id, display_name, phone FROM consumers WHERE id = $1 AND active = true`,
    [consumerId]
  )

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Consumer not found' })
  }

  const c = rows[0]
  const phone: string = c.phone
  const maskedPhone = phone.slice(0, 5) + '****' + phone.slice(-2)

  res.json({
    consumerId:  c.id,
    displayName: c.display_name ?? null,
    maskedPhone,
  })
})

// ─── PROTECTED: CONSUMER JWT required ────────────────────────────────────────

router.use(requireConsumerAuth)

// ─── Schema for consumer-initiated QR payment ────────────────────────────────
// Merchant ID comes from the URL; source is always QR_CODE — not in the body.

const consumerPaySchema = Joi.object({
  amountCents:    Joi.number().integer().min(100).max(100_000_000).required(),  // KSh 1,000,000 max — matches merchant limit
  idempotencyKey: Joi.string().length(32).hex().required(),
  timestamp:      Joi.number().integer().min(1_577_836_800_000).max(4_102_444_800_000).required(),
  currency:       Joi.string().valid('KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF').optional().default('KES'),
})

// ─── POST /api/v1/consumers/qr-token ─────────────────────────────────────────
// Issues a single-use, short-lived QR token the consumer wallet displays as a QR
// code. The merchant's terminal scans it, resolves the consumerId, and creates a
// transaction. Token is deleted on first use — cannot be replayed.

router.post('/qr-token', async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub

  const token = uuidv4()  // use the static import already at the top of the file
  const TTL_SECONDS = 90
  const expiresAt = Date.now() + TTL_SECONDS * 1000

  await redis.setex(`consumer:qr:${token}`, TTL_SECONDS, consumerId)

  res.json({ token, expiresAt })
})

// ─── POST /api/v1/consumers/me/fcm-token ─────────────────────────────────────
// Consumer wallet calls this on login and whenever FCM rotates the device token.

router.post('/me/fcm-token', async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub
  const { fcmToken } = req.body

  if (!fcmToken || typeof fcmToken !== 'string') {
    return res.status(400).json({ error: 'fcmToken is required' })
  }

  await db.query(
    'UPDATE consumers SET fcm_token = $1 WHERE id = $2',
    [fcmToken, consumerId]
  )

  res.json({ ok: true })
})

// ─── GET /api/v1/consumers/me ────────────────────────────────────────────────

router.get('/me', async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub

  const { rows } = await db.query(
    `SELECT id, phone, email, display_name, email_verified, sms_opt_in, created_at
     FROM consumers WHERE id = $1 AND active = true`,
    [consumerId]
  )

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Consumer not found' })
  }

  // Mask phone for client — last 4 only
  const consumer = rows[0]
  const maskedPhone = consumer.phone
    ? consumer.phone.slice(0, 5) + '****' + consumer.phone.slice(-2)
    : null

  res.json({ ...consumer, phone: maskedPhone })
})

// ─── PUT /api/v1/consumers/me ────────────────────────────────────────────────

router.put('/me', async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub
  const { displayName, smsOptIn } = req.body

  const updates: string[] = []
  const values: any[] = []
  let idx = 1

  if (displayName !== undefined) {
    updates.push(`display_name = $${idx++}`)
    values.push(displayName)
  }
  if (smsOptIn !== undefined) {
    updates.push(`sms_opt_in = $${idx++}`)
    values.push(Boolean(smsOptIn))
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  values.push(consumerId)
  await db.query(
    `UPDATE consumers SET ${updates.join(', ')} WHERE id = $${idx}`,
    values
  )

  logger.info('Consumer profile updated', { consumerId, fields: Object.keys(req.body) })
  res.json({ ok: true })
})

// ─── GET /api/v1/consumers/me/transactions ───────────────────────────────────

router.get('/me/transactions', async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub
  const limit  = Math.min(parseInt(req.query.limit as string) || 50, 200)
  const offset = parseInt(req.query.offset as string) || 0

  const { rows } = await db.query(
    `SELECT
       t.id, t.status, t.amount_cents, t.original_currency,
       t.original_amount_cents, t.mpesa_receipt, t.source,
       t.created_at, t.confirmed_at,
       m.name AS merchant_name
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     WHERE t.consumer_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [consumerId, limit, offset]
  )

  res.json({ transactions: rows, limit, offset })
})

// ─── GET /api/v1/consumers/me/loyalty ────────────────────────────────────────

router.get('/me/loyalty', async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub

  const { rows } = await db.query(
    `SELECT
       lb.merchant_id, m.name AS merchant_name,
       lp.reward_type, lp.points_per_ksh, lp.stamps_per_visit, lp.redeem_threshold,
       lb.points_balance, lb.stamps_balance, lb.lifetime_points, lb.lifetime_stamps
     FROM loyalty_balances lb
     JOIN merchants m ON m.id = lb.merchant_id
     LEFT JOIN loyalty_programmes lp ON lp.merchant_id = lb.merchant_id AND lp.active = true
     WHERE lb.consumer_id = $1
     ORDER BY lb.updated_at DESC`,
    [consumerId]
  )

  res.json({ balances: rows })
})

// ─── POST /api/v1/consumers/pay/:merchantId ──────────────────────────────────
// Consumer-initiated QR payment. The merchant ID comes from the URL so the
// consumer cannot spoof it. Source is always QR_CODE — no NFC/terminal logic.

router.post('/pay/:merchantId', validate(consumerPaySchema), async (req: Request, res: Response) => {
  const { merchantId }  = req.params
  const { amountCents, idempotencyKey, timestamp, currency = 'KES' } = req.body
  const consumerId = req.consumer!.sub

  // ─── Idempotency ─────────────────────────────────────────────────────────
  const cacheKey = `idempotency:${idempotencyKey}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    logger.info('Consumer pay: idempotency cache hit', { idempotencyKey })
    return res.json(JSON.parse(cached))
  }
  const existing = await db.query(
    'SELECT id, status, mpesa_receipt FROM transactions WHERE idempotency_key = $1',
    [idempotencyKey]
  )
  if (existing.rows.length > 0) {
    const t = existing.rows[0]
    return res.json({ status: t.status, txnId: t.id, mpesaRef: t.mpesa_receipt })
  }

  // ─── Validate merchant ────────────────────────────────────────────────────
  const merchantResult = await db.query(
    `SELECT id, name, approval_status, active FROM merchants WHERE id = $1`,
    [merchantId]
  )
  if (merchantResult.rows.length === 0 || !merchantResult.rows[0].active) {
    return res.status(404).json({ error: 'Merchant not found or inactive' })
  }
  if (merchantResult.rows[0].approval_status !== 'APPROVED') {
    return res.status(403).json({ error: 'Merchant is not accepting payments' })
  }
  const merchant = merchantResult.rows[0]

  // ─── Resolve consumer phone ───────────────────────────────────────────────
  const consumerResult = await db.query(
    'SELECT id, phone FROM consumers WHERE id = $1 AND active = true',
    [consumerId]
  )
  if (consumerResult.rows.length === 0) {
    return res.status(404).json({ error: 'Consumer account not found' })
  }
  const consumer = consumerResult.rows[0]
  if (!consumer.phone) {
    return res.status(422).json({
      error: 'No M-Pesa phone number on file — please update your profile'
    })
  }

  // ─── FX conversion ────────────────────────────────────────────────────────
  if (!isSupportedCurrency(currency)) {
    return res.status(400).json({ error: `Unsupported currency: ${currency}` })
  }
  let kesAmountCents: number
  let fxRate: number
  try {
    ;({ kesAmountCents, fxRate } = await convertToKes(amountCents, currency))
  } catch (fxErr: any) {
    logger.error('FX conversion failed (consumer pay)', { currency, amountCents, error: fxErr.message })
    return res.status(503).json({ error: 'Exchange rate unavailable — please try again' })
  }

  // ─── Write PENDING transaction ────────────────────────────────────────────
  // PENDING written BEFORE the STK Push — if the server crashes between the two,
  // reconciliation will detect PENDING + no M-Pesa record and expire it safely.
  const txnId = uuidv4()
  await db.query(
    `INSERT INTO transactions
       (id, merchant_id, consumer_id, amount_cents, source, idempotency_key, status,
        original_currency, original_amount_cents, fx_rate)
     VALUES ($1, $2, $3, $4, 'QR_CODE', $5, 'PENDING', $6, $7, $8)`,
    [txnId, merchantId, consumerId, kesAmountCents, idempotencyKey,
     currency, amountCents, fxRate === 1 ? null : fxRate]
  )

  logger.info('Consumer QR transaction created', {
    txnId, merchantId, consumerId, currency, amountCents, kesAmountCents
  })

  // ─── Fire STK Push ────────────────────────────────────────────────────────
  const callbackUrl = `${process.env.DARAJA_CALLBACK_BASE_URL}/api/v1/mpesa-callback`
  const amountKsh   = Math.ceil(kesAmountCents / 100)

  const stkResult = await stkPush({
    phoneNumber: consumer.phone,
    amount:      amountKsh,
    accountRef:  txnId.slice(0, 12),
    description: `Pay ${merchant.name}`.slice(0, 13),
    callbackUrl,
  })

  if (!stkResult.success) {
    await db.query(
      `UPDATE transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
      [txnId]
    )
    logger.error('STK Push failed (consumer pay)', { txnId, error: stkResult.errorMessage })
    return res.status(502).json({
      error:  'Could not send payment request to M-Pesa',
      detail: stkResult.errorMessage,
    })
  }

  // ─── Advance to STK_SENT ──────────────────────────────────────────────────
  await db.query(
    `UPDATE transactions
     SET checkout_request_id = $1, merchant_request_id = $2,
         status = 'STK_SENT', updated_at = NOW()
     WHERE id = $3`,
    [stkResult.checkoutRequestId, stkResult.merchantRequestId, txnId]
  )

  const pendingResponse = {
    status:  'STK_SENT' as const,
    txnId,
    message: 'M-Pesa prompt sent — waiting for customer to enter PIN',
  }
  await redis.setex(cacheKey, 120, JSON.stringify(pendingResponse))
  await redis.setex(`txn:${txnId}`, 120, JSON.stringify({ txnId, idempotencyKey }))

  logger.info('Consumer QR STK Push sent', {
    txnId, checkoutRequestId: stkResult.checkoutRequestId
  })

  res.status(201).json(pendingResponse)
})

// ─── POST /api/v1/consumers/p2p-token ────────────────────────────────────────
// Payee consumer calls this to generate a short-lived token the payer will use.
// The token encodes the payee's consumerId and optional preset amountCents.
// Stored in Redis as consumer:p2p:{token} → JSON for 90 seconds.
// Both P2P NFC (ConsumerHceService emits it) and P2P QR (P2PSendActivity shows it)
// use the same token format — the source field in the pay request distinguishes them.

const p2pTokenSchema = Joi.object({
  amountCents: Joi.number().integer().min(100).max(100_000_000).optional().allow(null),
})

router.post('/p2p-token', validate(p2pTokenSchema), async (req: Request, res: Response) => {
  const consumerId = req.consumer!.sub
  const { amountCents } = req.body

  const consumerResult = await db.query(
    'SELECT id, display_name FROM consumers WHERE id = $1 AND active = true',
    [consumerId]
  )
  if (consumerResult.rows.length === 0) {
    return res.status(404).json({ error: 'Consumer not found' })
  }
  const displayName: string | null = consumerResult.rows[0].display_name ?? null

  const token = uuidv4()
  const TTL_SECONDS = 90
  const expiresAt = Date.now() + TTL_SECONDS * 1000

  await redis.setex(`consumer:p2p:${token}`, TTL_SECONDS, JSON.stringify({
    consumerId,
    displayName,
    amountCents: amountCents ?? null,
  }))

  res.json({ token, expiresAt, displayName })
})

// ─── POST /api/v1/consumers/p2p-pay ──────────────────────────────────────────
// Payer consumer calls this to send money to another consumer.
// Identity of the payee is resolved from either:
//   - p2pToken: single-use Redis token issued by the payee via /consumers/p2p-token
//   - payeeConsumerId: direct UUID (only allowed when the payer already knows payee's ID)
// The STK Push fires to the PAYER's phone; payment goes to the platform's shortcode.
// The p2p_transactions row records the payer→payee routing layer.
//
// Requires PLATFORM_MERCHANT_ID env var pointing to the platform's merchant record.

router.post('/p2p-pay', validate(p2pPaySchema), async (req: Request, res: Response) => {
  const payerConsumerId = req.consumer!.sub
  const { p2pToken, payeeConsumerId: bodyPayeeId, amountCents,
          idempotencyKey, timestamp, source, currency = 'KES' } = req.body

  // ─── Idempotency ─────────────────────────────────────────────────────────
  const cacheKey = `idempotency:${idempotencyKey}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    logger.info('P2P pay: idempotency cache hit', { idempotencyKey })
    return res.json(JSON.parse(cached))
  }
  const existingP2p = await db.query(
    'SELECT id, status FROM p2p_transactions WHERE idempotency_key = $1',
    [idempotencyKey]
  )
  if (existingP2p.rows.length > 0) {
    const p = existingP2p.rows[0]
    return res.json({ status: p.status, p2pTxnId: p.id })
  }

  // ─── Resolve payee ────────────────────────────────────────────────────────
  let payeeConsumerId: string
  let payeeDisplayName: string | null = null

  if (p2pToken) {
    const redisKey = `consumer:p2p:${p2pToken}`
    const tokenData = await redis.get(redisKey)
    if (!tokenData) {
      return res.status(401).json({ error: 'P2P token expired or already used — ask payee to refresh' })
    }
    await redis.del(redisKey)  // single-use
    const parsed = JSON.parse(tokenData) as { consumerId: string; displayName: string | null; amountCents: number | null }
    payeeConsumerId = parsed.consumerId
    payeeDisplayName = parsed.displayName
    // If the token preset an amount, validate the payer isn't trying to pay a different amount
    if (parsed.amountCents !== null && parsed.amountCents !== amountCents) {
      return res.status(400).json({
        error: `Amount mismatch: payee requested KSh ${(parsed.amountCents / 100).toFixed(2)}`
      })
    }
  } else {
    payeeConsumerId = bodyPayeeId
    const payeeResult = await db.query(
      'SELECT id, display_name FROM consumers WHERE id = $1 AND active = true',
      [payeeConsumerId]
    )
    if (payeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payee consumer not found' })
    }
    payeeDisplayName = payeeResult.rows[0].display_name ?? null
  }

  // Self-payment guard
  if (payeeConsumerId === payerConsumerId) {
    return res.status(400).json({ error: 'Cannot send money to yourself' })
  }

  // ─── Resolve payer phone ──────────────────────────────────────────────────
  const payerResult = await db.query(
    'SELECT id, phone FROM consumers WHERE id = $1 AND active = true',
    [payerConsumerId]
  )
  if (payerResult.rows.length === 0) {
    return res.status(404).json({ error: 'Payer consumer not found' })
  }
  const payer = payerResult.rows[0]
  if (!payer.phone) {
    return res.status(422).json({ error: 'No M-Pesa phone number on file — please update your profile' })
  }

  // ─── Platform merchant ────────────────────────────────────────────────────
  // P2P payments go to the platform's M-Pesa shortcode (C2B STK Push).
  // The platform owes the payee the net amount after fees (future B2C disbursement).
  const platformMerchantId = process.env.PLATFORM_MERCHANT_ID
  if (!platformMerchantId) {
    logger.error('PLATFORM_MERCHANT_ID not configured — P2P pay unavailable')
    return res.status(503).json({ error: 'P2P payments temporarily unavailable' })
  }
  const platformResult = await db.query(
    'SELECT id, name FROM merchants WHERE id = $1 AND active = true',
    [platformMerchantId]
  )
  if (platformResult.rows.length === 0) {
    logger.error('PLATFORM_MERCHANT_ID points to missing/inactive merchant', { platformMerchantId })
    return res.status(503).json({ error: 'P2P payments temporarily unavailable' })
  }
  const platform = platformResult.rows[0]

  // ─── FX conversion ────────────────────────────────────────────────────────
  if (!isSupportedCurrency(currency)) {
    return res.status(400).json({ error: `Unsupported currency: ${currency}` })
  }
  let kesAmountCents: number
  let fxRate: number
  try {
    ;({ kesAmountCents, fxRate } = await convertToKes(amountCents, currency))
  } catch (fxErr: any) {
    logger.error('FX conversion failed (p2p-pay)', { currency, amountCents, error: fxErr.message })
    return res.status(503).json({ error: 'Exchange rate unavailable — please try again' })
  }

  // ─── Write PENDING transaction ────────────────────────────────────────────
  const txnId   = uuidv4()
  const p2pTxnId = uuidv4()

  await db.query(
    `INSERT INTO transactions
       (id, merchant_id, consumer_id, amount_cents, source, idempotency_key, status,
        original_currency, original_amount_cents, fx_rate)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9)`,
    [txnId, platformMerchantId, payerConsumerId, kesAmountCents, source, idempotencyKey,
     currency, amountCents, fxRate === 1 ? null : fxRate]
  )
  await db.query(
    `INSERT INTO p2p_transactions
       (id, transaction_id, payer_consumer_id, payee_consumer_id, amount_cents, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [p2pTxnId, txnId, payerConsumerId, payeeConsumerId, kesAmountCents, idempotencyKey]
  )

  logger.info('P2P transaction created', {
    txnId, p2pTxnId, payerConsumerId, payeeConsumerId, source, kesAmountCents
  })

  // ─── Fire STK Push to payer ───────────────────────────────────────────────
  const callbackUrl = `${process.env.DARAJA_CALLBACK_BASE_URL}/api/v1/mpesa-callback`
  const amountKsh   = Math.ceil(kesAmountCents / 100)
  const description = payeeDisplayName
    ? `Send to ${payeeDisplayName}`.slice(0, 13)
    : 'P2P Transfer'

  const stkResult = await stkPush({
    phoneNumber: payer.phone,
    amount:      amountKsh,
    accountRef:  txnId.slice(0, 12),
    description,
    callbackUrl,
  })

  if (!stkResult.success) {
    await db.query(
      `UPDATE transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [txnId]
    )
    await db.query(
      `UPDATE p2p_transactions SET status = 'FAILED' WHERE id = $1`, [p2pTxnId]
    )
    logger.error('STK Push failed (p2p-pay)', { txnId, p2pTxnId, error: stkResult.errorMessage })
    return res.status(502).json({
      error:  'Could not send payment request to M-Pesa',
      detail: stkResult.errorMessage,
    })
  }

  await db.query(
    `UPDATE transactions
     SET checkout_request_id = $1, merchant_request_id = $2,
         status = 'STK_SENT', updated_at = NOW()
     WHERE id = $3`,
    [stkResult.checkoutRequestId, stkResult.merchantRequestId, txnId]
  )

  const pendingResponse = {
    status:  'STK_SENT' as const,
    txnId,
    p2pTxnId,
    message: 'M-Pesa prompt sent — enter your PIN to complete',
  }
  await redis.setex(cacheKey, 120, JSON.stringify(pendingResponse))
  await redis.setex(`txn:${txnId}`, 120, JSON.stringify({ txnId, idempotencyKey }))

  logger.info('P2P STK Push sent', { txnId, p2pTxnId, checkoutRequestId: stkResult.checkoutRequestId })
  res.status(201).json(pendingResponse)
})

// ─── GET /api/v1/consumers/transactions/:txnId/status ────────────────────────
// Polled by the QR payment web page every 2.5 seconds.
// Enforces ownership: consumer can only poll their own transactions.

router.get('/transactions/:txnId/status', async (req: Request, res: Response) => {
  const { txnId }   = req.params
  const consumerId  = req.consumer!.sub

  // Redis fast path — check cache, but only after confirming ownership via DB.
  // IDOR fix: we cannot trust the Redis cache alone because `txn:{txnId}` is keyed
  // only by txnId (no consumer claim). A consumer who guesses another's txnId within
  // the 2-minute Redis TTL window would receive that other consumer's payment status.
  // Verify ownership in DB first (single indexed lookup — fast), then serve from cache.
  const { rows } = await db.query(
    `SELECT t.id, t.status, t.mpesa_receipt, t.amount_cents, t.mpesa_result_desc,
            t.idempotency_key, m.name AS merchant_name
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     WHERE t.id = $1 AND t.consumer_id = $2`,
    [txnId, consumerId]
  )

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Transaction not found' })
  }

  // Ownership verified — now serve from Redis cache if available (avoids re-querying for status)
  const txnIndex = await redis.get(`txn:${txnId}`)
  if (txnIndex) {
    const { idempotencyKey } = JSON.parse(txnIndex) as { idempotencyKey: string }
    const cached = await redis.get(`idempotency:${idempotencyKey}`)
    if (cached) {
      return res.json(JSON.parse(cached))
    }
  }

  const txn = rows[0]
  res.json({
    status:       txn.status,
    txnId:        txn.id,
    mpesaRef:     txn.mpesa_receipt,
    amountCents:  txn.amount_cents,
    merchantName: txn.merchant_name,
    reason:       txn.status !== 'CONFIRMED' ? txn.mpesa_result_desc : undefined,
  })
})

export default router
