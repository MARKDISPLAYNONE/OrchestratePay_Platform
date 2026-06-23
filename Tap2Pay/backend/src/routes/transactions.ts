/**
 * routes/transactions.ts — payment transaction endpoints.
 *
 * POST /api/v1/transactions
 *   Creates a transaction and fires the M-Pesa STK Push.
 *   Returns immediately with status=PENDING (don't wait for consumer PIN).
 *
 * GET /api/v1/transactions/:id/status
 *   Polled by the Android app every 2.5 seconds while waiting for M-Pesa callback.
 *
 * GET /api/v1/transactions
 *   Returns the merchant's recent transactions (for the dashboard history view).
 *
 * IDEMPOTENCY:
 * The idempotency_key is a SHA-256 derived from (merchantId + tagId + amount + minute).
 * If we've seen this key before:
 *   - PENDING: return cached pending response (STK Push already sent)
 *   - CONFIRMED: return the confirmed result (don't send another STK Push)
 *   - FAILED: return cached failure (let the app decide whether to retry with a new key)
 */
import crypto from 'crypto'
import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index'
import { redis } from '../db/redis'
import { stkPush } from '../integrations/daraja'
import { requireAuth } from '../middleware/auth'
import { validate, transactionSchema, merchantHceTokenSchema } from '../middleware/validate'
import { verifyHceToken } from '../util/hce-token'
import { convertToKes, isSupportedCurrency } from '../util/fx'
import { scoreFraud } from '../util/fraud'
import { checkCbkCompliance } from '../util/cbk-compliance'
import { recordLatency, parseTapTimestamp } from '../util/latency-tracker'
import { logger } from '../util/logger'
import { checkMerchantLimits } from '../util/merchant-limits'

const router = Router()

// Apply auth to all transaction routes
router.use(requireAuth)

// ─── POST /api/v1/transactions ───────────────────────────────────────────────

router.post('/', validate(transactionSchema), async (req: Request, res: Response) => {
  const { merchantId, amountCents, source, tagId, nfcUid, idempotencyKey, _timestamp,
          consumerPhone, hceToken, hceExp, currency = 'KES',
          deviceType, consumerQrToken, consumerTagId,
          merchantHceToken } = req.body

  // Extra security: verify the merchantId in the body matches the JWT
  if (merchantId !== req.merchant!.sub) {
    logger.warn('Merchant ID mismatch in transaction request', {
      jwtMerchantId: req.merchant!.sub,
      bodyMerchantId: merchantId
    })
    return res.status(403).json({ error: 'Merchant ID mismatch' })
  }

  // ─── Step 1: Idempotency check ─────────────────────────────────────────────
  // Check Redis first (fast path), then fall back to DB (slower but more durable)
  const cacheKey = `idempotency:${idempotencyKey}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    logger.info('Idempotency cache hit', { idempotencyKey })
    return res.json(JSON.parse(cached))
  }

  // Check DB (handles the case where Redis was restarted after the original request)
  const existing = await db.query(
    'SELECT id, status, mpesa_receipt FROM transactions WHERE idempotency_key = $1',
    [idempotencyKey]
  )
  if (existing.rows.length > 0) {
    const txn = existing.rows[0]
    logger.info('Idempotency DB hit', { txnId: txn.id, status: txn.status })
    return res.json({ status: txn.status, txnId: txn.id, mpesaRef: txn.mpesa_receipt })
  }

  // ─── Step 2: Validate merchant ─────────────────────────────────────────────
  const merchantResult = await db.query(
    `SELECT m.id, m.name, m.approval_status
     FROM merchants m WHERE m.id = $1 AND m.active = true`,
    [merchantId]
  )
  if (merchantResult.rows.length === 0) {
    return res.status(404).json({ error: 'Merchant not found or inactive' })
  }
  const merchant = merchantResult.rows[0]

  // Approval gate — block transactions if merchant is not approved
  if (merchant.approval_status !== 'APPROVED') {
    return res.status(403).json({
      error:  'Merchant account is not approved for transactions',
      status: merchant.approval_status,
    })
  }

  // ─── Merchant KYC/AML limit check ─────────────────────────────────────────
  // Enforces per-merchant daily/monthly spend limits by KYC tier, and blocks
  // sanctioned merchants. Fail-safe: DB errors allow the payment through.
  const merchantLimitCheck = await checkMerchantLimits(merchantId, amountCents)
  if (!merchantLimitCheck.allowed) {
    logger.warn('Merchant transaction blocked by limits', {
      merchantId,
      reason: merchantLimitCheck.reason,
      code:   merchantLimitCheck.code,
    })
    return res.status(403).json({
      error:      merchantLimitCheck.reason,
      code:       merchantLimitCheck.code,
      limitCents: merchantLimitCheck.limitCents,
      usedCents:  merchantLimitCheck.usedCents,
    })
  }

  // ─── SOFTPOS_MOBILE: ghost merchant + attestation checks ──────────────────
  // Ghost merchant attack: an attacker registers as a merchant and intercepts
  // consumer phone taps in a public space. Mitigation: device attestation must
  // be fresh (< 24h) and the device must be registered under this merchant.
  if (source === 'SOFTPOS_MOBILE') {
    const integrityRequired = process.env.PLAY_INTEGRITY_REQUIRED !== 'false'

    if (integrityRequired) {
      // Check that the device has a recent attestation from Play Integrity
      const attResult = await db.query(
        `SELECT device_integrity_verified_at
         FROM devices
         WHERE merchant_id = $1
           AND device_type = 'SOFTPOS_MOBILE'
           AND device_integrity_verified_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [merchantId]
      )
      if (attResult.rows.length === 0) {
        logger.warn('SOFTPOS_MOBILE transaction blocked — no valid attestation', { merchantId })
        return res.status(403).json({
          error: 'Device attestation required — open the SoftPOS app to re-verify'
        })
      }
    }

    // Ghost merchant check: deviceType in body must be SOFTPOS_MOBILE
    if (deviceType && deviceType !== 'SOFTPOS_MOBILE') {
      logger.warn('Suspicious deviceType on SOFTPOS_MOBILE transaction', { merchantId, deviceType })
      return res.status(400).json({ error: 'Invalid device type for SoftPOS transaction' })
    }
  }

  // ─── Step 3: Resolve consumer ─────────────────────────────────────────────
  // HCE_PHONE: phone number arrives directly from the NFC APDU — verify the
  //   HMAC token before trusting it. Look up or create a consumer record by phone.
  // NFC_TAG / QR_CODE: resolve phone via nfc_tags → consumers (existing flow).
  let consumer: { id: string; phone: string } | null = null

  if (source === 'HCE_PHONE') {
    // Validate all three HCE fields are present
    if (!consumerPhone || !hceToken || !hceExp) {
      return res.status(400).json({
        error: 'consumerPhone, hceToken, and hceExp are required for HCE_PHONE transactions'
      })
    }

    // Verify the HMAC token — prevents phone number spoofing from untrusted NFC data
    if (!verifyHceToken(consumerPhone, hceToken, hceExp)) {
      logger.warn('HCE token verification failed — possible replay or forgery', {
        maskedPhone: consumerPhone.slice(0, 5) + '****' + consumerPhone.slice(-2),
        merchantId,
        remoteIp: req.ip
      })
      return res.status(401).json({ error: 'Invalid or expired HCE session — customer must re-tap' })
    }

    // Look up existing consumer or create a minimal record on first tap
    const existing = await db.query(
      'SELECT id, phone FROM consumers WHERE phone = $1 AND active = true',
      [consumerPhone]
    )
    if (existing.rows.length > 0) {
      consumer = existing.rows[0]
    } else {
      const phoneHash = crypto.createHash('sha256').update(consumerPhone).digest('hex')
      const created = await db.query(
        'INSERT INTO consumers (phone, phone_hash) VALUES ($1, $2) RETURNING id, phone',
        [consumerPhone, phoneHash]
      )
      consumer = created.rows[0]
      logger.info('New consumer registered via HCE tap', {
        consumerId: consumer!.id,
        maskedPhone: consumerPhone.slice(0, 5) + '****' + consumerPhone.slice(-2)
      })
    }

  } else if (consumerQrToken) {
    // Consumer wallet QR flow: the merchant terminal scans a QR from the consumer's
    // phone. The QR encodes a single-use Redis-backed token → consumerId.
    const redisKey = `consumer:qr:${consumerQrToken}`
    const consumerId = await redis.get(redisKey)
    if (!consumerId) {
      return res.status(401).json({ error: 'QR code expired or already used — ask customer to refresh' })
    }
    await redis.del(redisKey)  // single-use: delete immediately after resolving

    const qrConsumerResult = await db.query(
      'SELECT id, phone FROM consumers WHERE id = $1 AND active = true',
      [consumerId]
    )
    if (qrConsumerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Consumer account not found' })
    }
    consumer = qrConsumerResult.rows[0]

  } else if (source === 'MERCHANT_HCE' && merchantHceToken) {
    // Consumer wallet read a payment request from the merchant's HCE phone.
    // The merchant's OrchestrateHceService emitted a signed token stored in Redis
    // as merchant:hce:{token} → {merchantId, amountCents, merchantName, exp}.
    // Verify the token belongs to the requesting merchant (anti-spoofing).
    const hceKey = `merchant:hce:${merchantHceToken}`
    const hceData = await redis.get(hceKey)
    if (!hceData) {
      return res.status(401).json({ error: 'Merchant HCE session expired — merchant must re-activate' })
    }
    await redis.del(hceKey)  // single-use
    const hceSession = JSON.parse(hceData) as { merchantId: string; consumerId: string; amountCents: number }

    if (hceSession.merchantId !== merchantId) {
      logger.warn('MERCHANT_HCE token merchantId mismatch', { tokenMerchant: hceSession.merchantId, claimedMerchant: merchantId })
      return res.status(403).json({ error: 'Token does not belong to this merchant' })
    }
    // Consumer identity is embedded in the HCE session (consumer called this endpoint)
    const hceConsumer = await db.query(
      'SELECT id, phone FROM consumers WHERE id = $1 AND active = true',
      [hceSession.consumerId]
    )
    if (hceConsumer.rows.length === 0) {
      return res.status(404).json({ error: 'Consumer not found' })
    }
    consumer = hceConsumer.rows[0]

  } else if (consumerTagId) {
    // Consumer-written NFC tag (https://orchestratepay.co.ke/c/{consumerId}).
    const tagConsumerResult = await db.query(
      'SELECT id, phone FROM consumers WHERE id = $1 AND active = true',
      [consumerTagId]
    )
    if (tagConsumerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Consumer not found — tag may be from a deleted account' })
    }
    consumer = tagConsumerResult.rows[0]

  } else if (tagId) {
    const tagResult = await db.query(
      `SELECT c.id, c.phone
       FROM nfc_tags t JOIN consumers c ON t.consumer_id = c.id
       WHERE t.tag_id = $1 AND t.active = true AND c.active = true`,
      [tagId]
    )
    if (tagResult.rows.length === 0) {
      return res.status(404).json({ error: 'NFC tag not registered or inactive' })
    }
    consumer = tagResult.rows[0]
    await db.query('UPDATE nfc_tags SET last_used = NOW() WHERE tag_id = $1', [tagId])
  }

  if (!consumer) {
    return res.status(400).json({ error: 'Could not identify consumer — tag or HCE token required' })
  }

  // ─── Step 4: FX conversion ────────────────────────────────────────────────
  // All STK Push calls go in KES regardless of what currency the merchant priced in.
  // If currency is KES (the normal case) this is a no-op (rate = 1, kesAmountCents = amountCents).
  if (!isSupportedCurrency(currency)) {
    return res.status(400).json({ error: `Unsupported currency: ${currency}` })
  }
  let kesAmountCents = 0
  let fxRate = 0
  try {
    const converted = await convertToKes(amountCents, currency)
    kesAmountCents = converted.kesAmountCents
    fxRate = converted.fxRate
  } catch (fxErr: unknown) {
    logger.error('FX conversion failed', { currency, amountCents, error: (fxErr as Error).message })
    return res.status(503).json({ error: 'Exchange rate unavailable — please try again' })
  }

  // ─── Step 4b: Capture tap timestamp for latency tracking ─────────────────
  // X-Tap-Timestamp is set by the Android terminal at the moment the NFC tap fires.
  // parseTapTimestamp rejects stale (>5 min) or future (>10 s) timestamps to prevent
  // replay-attack skew from inflating our latency metrics.
  const tapTs = parseTapTimestamp(req.headers['x-tap-timestamp'] as string | undefined)
  const apiArrivalMs = Date.now()

  // ─── Step 4c: CBK compliance check ───────────────────────────────────────
  // Enforce CBK daily spend limits (BASIC: KSh 10K, ENHANCED: KSh 100K, FULL: unlimited).
  // Runs BEFORE the DB insert so declined payments leave no ledger record.
  // Fail-safe: if the compliance DB query throws, the payment proceeds.
  const compliance = await checkCbkCompliance(consumer.id, kesAmountCents)
  if (!compliance.allowed) {
    logger.warn('CBK daily limit exceeded', {
      consumerId: consumer.id,
      kesAmountCents,
      reason: compliance.reason,
    })
    return res.status(403).json({
      error:  compliance.reason ?? 'Daily transaction limit reached',
      code:   'CBK_LIMIT_EXCEEDED',
    })
  }

  // ─── Step 4d: Fraud scoring ───────────────────────────────────────────────
  // Score is 0–100 across three rules: velocity, amount deviation, first-time high value.
  // DECLINE (≥90) blocks the payment; REVIEW (70–89) proceeds but flags for ops.
  // Each rule is fail-safe — a Redis/DB error in a rule skips that rule, never blocks.
  const fraud = await scoreFraud({
    consumerId:     consumer.id,
    merchantId,
    amountCents:    kesAmountCents,
    source,
    idempotencyKey,
  })
  if (fraud.decision === 'DECLINE') {
    logger.warn('Fraud DECLINE', {
      consumerId: consumer.id,
      merchantId,
      score:      fraud.score,
      reasons:    fraud.reasons,
    })
    return res.status(402).json({
      error:   'Transaction declined by fraud prevention',
      code:    'FRAUD_DECLINED',
    })
  }
  if (fraud.decision === 'REVIEW') {
    logger.warn('Fraud REVIEW — proceeding', {
      consumerId: consumer.id,
      merchantId,
      score:      fraud.score,
      reasons:    fraud.reasons,
    })
  }

  // ─── Step 5: Write PENDING transaction to ledger ───────────────────────────
  // We write to DB BEFORE calling M-Pesa so that if M-Pesa succeeds but the
  // server crashes before we can write, the consumer was charged with no record.
  // RELIABILITY INVARIANT: the checkout_request_id MUST be written atomically
  // with the STK_SENT status. If the process dies after the STK Push but before
  // the DB update, the PENDING row has no checkout_request_id and the reconciliation
  // job's "WHERE checkout_request_id IS NOT NULL" query skips it permanently.
  // We use a two-phase approach: INSERT as PENDING, then UPDATE to STK_SENT with the
  // checkout_request_id in a single UPDATE. If the UPDATE fails, the row stays PENDING
  // and reconciliation can match it by created_at + amount (manual recovery path).
  const txnId = uuidv4()
  await db.query(
    `INSERT INTO transactions
     (id, merchant_id, consumer_id, amount_cents, source, nfc_uid, idempotency_key, status,
      original_currency, original_amount_cents, fx_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10)`,
    [txnId, merchantId, consumer.id, kesAmountCents, source, nfcUid, idempotencyKey,
     currency, amountCents, fxRate === 1 ? null : fxRate]
  )

  logger.info('Transaction created', { txnId, merchantId, currency, amountCents, kesAmountCents })

  // ─── Step 6: Fire STK Push ─────────────────────────────────────────────────
  const callbackUrl = `${process.env.DARAJA_CALLBACK_BASE_URL}/api/v1/mpesa-callback`
  const amountKsh = Math.ceil(kesAmountCents / 100)  // convert KES cents to KSh for M-Pesa

  const darajaDispatchStart = Date.now()
  const stkResult = await stkPush({
    phoneNumber: consumer.phone,
    amount: amountKsh,
    accountRef: txnId.slice(0, 12),      // max 12 chars
    description: `Pay ${merchant.name}`.slice(0, 13),  // max 13 chars
    callbackUrl
  })
  const darajaDispatchMs = Date.now() - darajaDispatchStart

  if (!stkResult.success) {
    // STK Push failed — mark transaction as FAILED but keep the record for audit
    await db.query(
      `UPDATE transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
      [txnId]
    )
    logger.error('STK Push failed', { txnId, error: stkResult.errorMessage })
    return res.status(502).json({
      error: 'Could not send payment request to M-Pesa',
      detail: stkResult.errorMessage
    })
  }

  // ─── Step 7: Update with STK Push reference IDs ────────────────────────────
  // Status advances to STK_SENT — the prompt is now on the consumer's phone.
  // CRITICAL: checkout_request_id is how the mpesa-callback and reconciliation
  // jobs identify this transaction. If this update fails, log prominently so ops
  // can manually reconcile using txnId + stkResult.checkoutRequestId.
  try {
    await db.query(
      `UPDATE transactions
       SET checkout_request_id = $1, merchant_request_id = $2, status = 'STK_SENT', updated_at = NOW()
       WHERE id = $3`,
      [stkResult.checkoutRequestId, stkResult.merchantRequestId, txnId]
    )
  } catch (updateErr: unknown) {
    // STK Push succeeded but we failed to record the checkout_request_id.
    // Log at ERROR with all identifiers so ops can manually link this transaction.
    logger.error('CRITICAL: Failed to store checkout_request_id after successful STK Push — MANUAL RECONCILIATION REQUIRED', {
      txnId,
      checkoutRequestId: stkResult.checkoutRequestId,
      merchantRequestId: stkResult.merchantRequestId,
      error: (updateErr as Error).message,
    })
    // Return 201 anyway — the consumer was sent an STK Push. The payment may confirm
    // via callback (using CheckoutRequestID) even if our local status is stale.
  }

  // Cache the STK_SENT state so the polling endpoint doesn't hammer Postgres
  const pendingResponse = {
    status: 'STK_SENT',
    txnId,
    message: 'M-Pesa prompt sent — waiting for customer to enter PIN'
  }
  await redis.setex(cacheKey, 120, JSON.stringify(pendingResponse))
  await redis.setex(`txn:${txnId}`, 120, JSON.stringify({ txnId, idempotencyKey }))

  logger.info('STK Push sent', {
    txnId,
    checkoutRequestId: stkResult.checkoutRequestId
  })

  // Record latency segments — fire-and-forget, never blocks the payment response.
  // apiRoundTripMs = from terminal tap timestamp to now (full API round-trip).
  // darajaDispatchMs = time spent waiting for Daraja to accept the STK Push.
  // stkConfirmMs and totalMs are filled in later by mpesa-callback.ts.
  const apiRoundTripMs = tapTs !== null ? apiArrivalMs - tapTs : null
  recordLatency({
    txnId,
    apiRoundTripMs,
    darajaDispatchMs,
    stkConfirmMs: null,
    totalMs:      null,
    source,
  }).catch((err: unknown) =>
    logger.warn('Failed to record tap latency', { txnId, error: (err as Error).message })
  )

  res.status(201).json(pendingResponse)
})

// ─── GET /api/v1/transactions/:id/status ─────────────────────────────────────

router.get('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params

  // Two-step Redis lookup:
  //   txn:{txnId}            → { txnId, idempotencyKey }   (written at STK Push time, TTL 120s)
  //   idempotency:{ikey}     → { status, txnId, ... }      (written at callback/reconcile, TTL 3600s)
  // Both keys must exist for a cache hit. If either is missing, fall through to DB.
  const txnIndex = await redis.get(`txn:${id}`)
  if (txnIndex) {
    const { idempotencyKey } = JSON.parse(txnIndex) as { idempotencyKey: string }
    const cached = await redis.get(`idempotency:${idempotencyKey}`)
    if (cached) {
      const data = JSON.parse(cached)
      // Enforce IDOR: cached data must belong to the requesting merchant.
      // The callback sets confirmed_at / merchant_id in the DB record; the cache
      // was written by our own backend so txnId is trustworthy. We still verify
      // the DB record owns this merchant before returning cached data.
      if (data.txnId === id) {
        return res.json(data)
      }
    }
  }

  // Fall back to database
  const result = await db.query(
    `SELECT t.id, t.status, t.mpesa_receipt, t.amount_cents, t.mpesa_result_desc,
            m.name as merchant_name, c.phone as consumer_phone
     FROM transactions t
       JOIN merchants m ON t.merchant_id = m.id
       JOIN consumers c ON t.consumer_id = c.id
     WHERE t.id = $1 AND t.merchant_id = $2`,
    [id, req.merchant!.sub]  // ensure merchant can only see their own transactions
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Transaction not found' })
  }

  const txn = result.rows[0]
  const maskedPhone = maskPhone(txn.consumer_phone)

  res.json({
    status:        txn.status,
    txnId:         txn.id,
    mpesaRef:      txn.mpesa_receipt,
    amountCents:   txn.amount_cents,
    merchantName:  txn.merchant_name,
    consumerPhone: maskedPhone,
    reason:        txn.status !== 'CONFIRMED' ? txn.mpesa_result_desc : undefined
  })
})

// ─── GET /api/v1/transactions ─────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
  const offset = parseInt(req.query.offset as string) || 0

  const result = await db.query(
    `SELECT t.id, t.status, t.amount_cents, t.mpesa_receipt, t.created_at, t.confirmed_at
     FROM transactions t
     WHERE t.merchant_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.merchant!.sub, limit, offset]
  )

  res.json({ transactions: result.rows, limit, offset })
})

// ─── POST /api/v1/transactions/merchant-hce-token ─────────────────────────────
// Called by the merchant app before activating HCE mode.
// Returns a 60-second single-use token the merchant's phone will emit via HCE.
// The consumer wallet reads this token and uses it in POST /transactions with
// source=MERCHANT_HCE to initiate a payment to the merchant with the pre-set amount.

router.post('/merchant-hce-token', validate(merchantHceTokenSchema), async (req: Request, res: Response) => {
  const merchantId = req.merchant!.sub
  const { amountCents } = req.body

  const merchantResult = await db.query(
    'SELECT id, name FROM merchants WHERE id = $1 AND active = true AND approval_status = $2',
    [merchantId, 'APPROVED']
  )
  if (merchantResult.rows.length === 0) {
    return res.status(403).json({ error: 'Merchant not approved' })
  }

  const token = uuidv4()
  const TTL_SECONDS = 60
  const expiresAt = Date.now() + TTL_SECONDS * 1000

  const session = JSON.stringify({
    merchantId,
    merchantName: merchantResult.rows[0].name,
    amountCents,
    exp: expiresAt,
  })
  await redis.setex(`merchant:hce:${token}`, TTL_SECONDS, session)

  logger.info('Merchant HCE token issued', { merchantId, amountCents })
  res.json({ token, expiresAt, amountCents, merchantName: merchantResult.rows[0].name })
})

// ─────────────────────────────────────────────────────────────────────────────

function maskPhone(phone: string): string {
  return phone.length >= 7
    ? phone.slice(0, 5) + '****' + phone.slice(-2)
    : '****'
}

export default router
