/**
 * routes/mpesa-callback.ts — receives and processes M-Pesa STK Push callbacks.
 *
 * This endpoint is called by SAFARICOM'S SERVERS, not by our Android app.
 * URL: POST /api/v1/mpesa-callback
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOLDEN RULES — violating these causes production incidents:    ║
 * ║                                                                  ║
 * ║  1. Respond to Safaricom FIRST (within 5 seconds)               ║
 * ║     Then process asynchronously.                                 ║
 * ║                                                                  ║
 * ║  2. Check ResultCode BEFORE touching CallbackMetadata            ║
 * ║     CallbackMetadata is ABSENT when ResultCode ≠ 0              ║
 * ║                                                                  ║
 * ║  3. Handle duplicate callbacks gracefully                        ║
 * ║     Safaricom retries if it doesn't get a 200 quickly           ║
 * ║                                                                  ║
 * ║  4. Never trust the amount in the callback for settlement        ║
 * ║     Compare with what's in your DB — callbacks can be spoofed   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * CALLBACK AUTHENTICATION:
 * Safaricom does not sign callbacks — there's no HMAC or shared secret.
 * Mitigate spoofing by:
 *   a) Only allowing Safaricom's IP ranges in your firewall/nginx config
 *   b) Verifying the CheckoutRequestID exists in your DB before processing
 *   c) Verifying the Amount matches your DB record
 *
 * RESULT CODES (common ones):
 *   0    = Success
 *   1    = Insufficient funds  
 *   17   = Transaction limit exceeded
 *   1032 = Request cancelled by user
 *   1037 = Timeout — user did not respond
 *   2001 = Wrong PIN entered
 */
import { Router, Request, Response } from 'express'
import { db } from '../db/index'
import { redis } from '../db/redis'
import { logger } from '../util/logger'
import { stkQuery } from '../integrations/daraja'
import { awardLoyaltyPoints, isRepeatCustomer } from '../util/loyalty'
import { submitFiscalInvoice } from '../integrations/etims'
import { sendSms, SmsTemplate } from '../integrations/africas-talking'
import { enqueueGlPosting }   from '../jobs/gl-posting'
import { sendFcmNotification } from '../util/fcm'

const router = Router()

// ─── POST /api/v1/mpesa-callback ─────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ RULE 1: RESPOND TO SAFARICOM IMMEDIATELY                        ║
  // ║ Do this BEFORE any database operations.                         ║
  // ║ If we respond late, Safaricom retries the callback.             ║
  // ║ Multiple callbacks for the same event → duplicate processing.   ║
  // ╚══════════════════════════════════════════════════════════════════╝
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' })

  // Everything below this line runs AFTER the response is sent
  try {
    await processCallback(req.body, req.ip)
  } catch (err: any) {
    // Log but don't crash — Safaricom already got its 200, no point crashing
    logger.error('Callback processing error (async)', { error: err.message })
  }
})

async function processCallback(body: any, remoteIp: string | undefined) {
  const stkCallback = body?.Body?.stkCallback

  if (!stkCallback) {
    logger.warn('Malformed callback body — missing stkCallback', { body })
    // Still archive malformed bodies — forensic value in case of an attack
    await db.query(
      `INSERT INTO daraja_callback_log (remote_ip, raw_body) VALUES ($1, $2)`,
      [remoteIp, JSON.stringify(body)]
    ).catch(() => {})  // never let logging failure affect anything else
    return
  }

  const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback

  // ── Archive raw callback immediately (7-year CBK compliance) ──────────────
  // Do this before any business logic so we never lose a callback even if
  // downstream processing fails. The `verified` column is updated later.
  let callbackLogId: bigint | null = null
  try {
    const logRow = await db.query(
      `INSERT INTO daraja_callback_log
         (remote_ip, checkout_request_id, result_code, raw_body)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [remoteIp, CheckoutRequestID, ResultCode, JSON.stringify(body)]
    )
    callbackLogId = logRow.rows[0]?.id ?? null
  } catch (logErr: any) {
    logger.error('Failed to archive Daraja callback — proceeding anyway', { error: logErr.message })
  }

  logger.info('M-Pesa callback received', {
    checkoutRequestId: CheckoutRequestID,
    resultCode: ResultCode,
    remoteIp
  })

  // Look up transaction by CheckoutRequestID
  const result = await db.query(
    `SELECT t.id, t.status, t.amount_cents, t.idempotency_key,
            t.merchant_id, t.consumer_id, t.source,
            m.kra_pin, m.name AS merchant_name,
            c.phone AS consumer_phone, c.sms_opt_in, c.fcm_token
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     JOIN consumers c ON c.id = t.consumer_id
     WHERE t.checkout_request_id = $1`,
    [CheckoutRequestID]
  )

  if (result.rows.length === 0) {
    // Unknown CheckoutRequestID — could be a spoofed callback or a race condition
    // with our reconciliation job. Log it and move on.
    logger.warn('Callback for unknown CheckoutRequestID', { CheckoutRequestID })
    return
  }

  const txn = result.rows[0]

  // ─── Idempotency: ignore if already processed ─────────────────────────────
  // Allow PENDING (callback beat our step-6 status update) and STK_SENT (normal path).
  // Block all terminal states — a second callback for the same transaction is a no-op.
  const isProcessable = txn.status === 'PENDING' || txn.status === 'STK_SENT'
  if (!isProcessable) {
    logger.info('Ignoring duplicate callback — transaction already processed', {
      txnId: txn.id,
      currentStatus: txn.status
    })
    return
  }

  if (ResultCode === 0) {
    // ╔═══════════════════════════════════════════════════════════════════╗
    // ║ RULE 2: CHECK ResultCode BEFORE accessing CallbackMetadata      ║
    // ║ CallbackMetadata ONLY exists when ResultCode === 0               ║
    // ║ Accessing it when ResultCode !== 0 → TypeError crash            ║
    // ╚═══════════════════════════════════════════════════════════════════╝

    // Helper to extract a named item from CallbackMetadata.Item array
    const getItem = (name: string) =>
      CallbackMetadata?.Item?.find((i: any) => i.Name === name)?.Value

    const mpesaReceipt = getItem('MpesaReceiptNumber') as string
    const callbackAmount = getItem('Amount') as number

    // ── Security: verify the claimed-success with Daraja before committing ────
    // Callbacks can be spoofed — Safaricom doesn't sign them.
    // Belt-and-suspenders beyond IP filtering: ask Daraja directly whether
    // this CheckoutRequestID actually succeeded.
    //
    // If the circuit is OPEN we can't reach Daraja, so we trust the callback
    // (IP filter already provides a baseline) and let the reconciliation job
    // do a follow-up query on the next run.
    const queryResult = await stkQuery(CheckoutRequestID)
    const verified = queryResult.resultCode !== -1  // -1 = circuit open / unreachable

    if (verified && queryResult.resultCode !== 0) {
      // Daraja says the transaction did NOT succeed — callback was spoofed or stale
      logger.error('CALLBACK VERIFICATION FAILED — Daraja disputes success claim', {
        txnId: txn.id,
        checkoutRequestId: CheckoutRequestID,
        callbackResultCode: ResultCode,
        queryResultCode: queryResult.resultCode,
        queryResultDesc: queryResult.resultDesc,
        remoteIp
      })
      if (callbackLogId) {
        await db.query(
          `UPDATE daraja_callback_log SET verified = false WHERE id = $1`,
          [callbackLogId]
        ).catch(() => {})
      }
      await db.query(
        `UPDATE transactions
         SET status = 'FAILED', mpesa_result_code = -2,
             mpesa_result_desc = 'Callback verification failed — possible fraud', updated_at = NOW()
         WHERE id = $1`,
        [txn.id]
      )
      return
    }

    if (!verified) {
      logger.warn('Skipping stkQuery verification — Daraja circuit OPEN; trusting IP-filtered callback', {
        txnId: txn.id,
        checkoutRequestId: CheckoutRequestID
      })
    }

    if (callbackLogId) {
      await db.query(
        `UPDATE daraja_callback_log SET verified = $1 WHERE id = $2`,
        [verified ? true : null, callbackLogId]  // null = verification skipped
      ).catch(() => {})
    }

    // Security check: verify the callback amount matches our DB record
    // Protects against spoofed callbacks with a higher amount
    const expectedKsh = Math.ceil(txn.amount_cents / 100)
    if (callbackAmount && callbackAmount !== expectedKsh) {
      logger.error('AMOUNT MISMATCH in callback — possible spoofing attack', {
        txnId: txn.id,
        expectedKsh,
        callbackAmount,
        remoteIp
      })
      // Still update the DB as FAILED — don't silently ignore this
      await db.query(
        `UPDATE transactions
         SET status = 'FAILED', mpesa_result_code = -1,
             mpesa_result_desc = 'Amount mismatch — possible fraud', updated_at = NOW()
         WHERE id = $1`,
        [txn.id]
      )
      return
    }

    // Confirm the transaction
    await db.query(
      `UPDATE transactions
       SET status = 'CONFIRMED',
           mpesa_receipt = $1,
           mpesa_result_code = 0,
           mpesa_result_desc = $2,
           confirmed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [mpesaReceipt, ResultDesc, txn.id]
    )

    // Update idempotency cache with confirmed result (3600s = 1 hour)
    const confirmedPayload = {
      status:      'CONFIRMED' as const,
      txnId:       txn.id,
      mpesaRef:    mpesaReceipt,
      amountCents: txn.amount_cents,
    }
    await redis.setex(`idempotency:${txn.idempotency_key}`, 3600, JSON.stringify(confirmedPayload))
    await redis.del(`txn:${txn.id}`)  // clean up pending marker

    logger.info('Transaction confirmed', {
      txnId: txn.id,
      mpesaReceipt,
      amountCents: txn.amount_cents
    })

    // Enqueue GL posting to accounting system — non-fatal, fire-and-forget
    enqueueGlPosting(
      txn.id,
      txn.merchant_id,
      txn.amount_cents,
      'KES',
      mpesaReceipt ?? '',
      new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
    ).catch((err: Error) => {
      logger.error('GL posting enqueue failed', { txnId: txn.id, error: err.message })
    })

    // Award loyalty points/stamps — non-fatal if it fails
    const [loyaltyResult, repeatCustomer] = await Promise.all([
      awardLoyaltyPoints(txn.id, txn.merchant_id, txn.consumer_id, txn.amount_cents, db),
      isRepeatCustomer(txn.consumer_id, txn.merchant_id, db),
    ])

    // Submit fiscal invoice to KRA eTIMS if merchant has a KRA PIN — non-fatal
    if (txn.kra_pin) {
      submitFiscalInvoice({
        merchantId:    txn.merchant_id,
        transactionId: txn.id,
        kraPin:        txn.kra_pin,
        amountCents:   txn.amount_cents,
        mpesaReceipt:  mpesaReceipt ?? '',
        issuedAt:      new Date().toISOString(),
      }, db).catch((err: Error) => {
        logger.error('eTIMS invoice submission failed', { txnId: txn.id, err: err.message })
      })
    }

    // Send confirmation SMS to consumer if they opted in, OR if this is a SOFTPOS_MOBILE
    // transaction (SoftPOS has no printer — SMS is the only receipt the consumer gets)
    const isSoftPos = txn.source === 'SOFTPOS_MOBILE'
    if ((txn.sms_opt_in || isSoftPos) && txn.consumer_phone) {
      const amountKsh = txn.amount_cents / 100
      const template  = isSoftPos
        ? SmsTemplate.digitalReceipt(
            amountKsh, txn.merchant_name, mpesaReceipt ?? '',
            new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })
          )
        : SmsTemplate.paymentConfirmed(amountKsh, txn.merchant_name, mpesaReceipt ?? '')

      sendSms(txn.consumer_phone, template).catch(() => {})
    }

    // Notify the merchant terminal via Redis pub/sub (WebSocket or polling fallback)
    const enrichedPayload = {
      ...confirmedPayload,
      repeatCustomer,
      loyaltyPoints:  loyaltyResult?.pointsDelta  ?? 0,
      loyaltyStamps:  loyaltyResult?.stampsDelta  ?? 0,
    }
    await redis.publish(`txn:confirmed:${txn.id}`, JSON.stringify(enrichedPayload))

    // Notify the consumer wallet — WebSocket primary, FCM fallback
    const consumerEvent = JSON.stringify({
      type:         'PAYMENT_RECEIVED',
      status:       'CONFIRMED',
      txnId:        txn.id,
      amountCents:  txn.amount_cents,
      merchantName: txn.merchant_name,
      mpesaRef:     mpesaReceipt ?? '',
    })
    await redis.publish(`consumer:payment:${txn.consumer_id}`, consumerEvent)

    // Send FCM push if consumer has no active WebSocket connection
    if (txn.fcm_token) {
      const hasActiveWs = await redis.exists(`consumer:ws:${txn.consumer_id}`)
      if (!hasActiveWs) {
        const amountKsh = (txn.amount_cents / 100).toFixed(2)
        sendFcmNotification({
          fcmToken: txn.fcm_token,
          title:    'Payment confirmed',
          body:     `KSh ${amountKsh} paid to ${txn.merchant_name}`,
          data: {
            txnId:        txn.id,
            mpesaRef:     mpesaReceipt ?? '',
            amountCents:  String(txn.amount_cents),
            merchantName: txn.merchant_name,
            status:       'CONFIRMED',
          },
        }).catch(() => {})
      }
    }

  } else {
    // Payment failed (cancelled, insufficient funds, wrong PIN, timeout)
    const failedPayload = {
      status: 'DECLINED',
      txnId:  txn.id,
      reason: friendlyReason(ResultCode),
      code:   ResultCode
    }

    await db.query(
      `UPDATE transactions
       SET status = 'DECLINED', mpesa_result_code = $1,
           mpesa_result_desc = $2, updated_at = NOW()
       WHERE id = $3`,
      [ResultCode, ResultDesc, txn.id]
    )

    await redis.setex(`idempotency:${txn.idempotency_key}`, 300, JSON.stringify(failedPayload))
    await redis.del(`txn:${txn.id}`)

    logger.info('Transaction declined', { txnId: txn.id, resultCode: ResultCode, resultDesc: ResultDesc })

    await redis.publish(`txn:confirmed:${txn.id}`, JSON.stringify(failedPayload))
  }

  // Write to server audit log (summary — raw body is in daraja_callback_log)
  await db.query(
    `INSERT INTO server_audit_log (event, entity_type, entity_id, detail, ip_address)
     VALUES ('MPESA_CALLBACK', 'transaction', $1, $2, $3)`,
    [txn.id, JSON.stringify({ resultCode: ResultCode, resultDesc: ResultDesc }), remoteIp]
  )
}

/**
 * friendlyReason — converts M-Pesa result codes to user-facing messages.
 * Never show raw codes to merchants or consumers.
 */
function friendlyReason(code: number): string {
  switch (code) {
    case 1:    return 'Customer has insufficient M-Pesa balance'
    case 17:   return 'Customer has exceeded their daily transaction limit'
    case 1032: return 'Customer cancelled the payment request'
    case 1037: return 'Payment timed out — customer did not respond within 60 seconds'
    case 2001: return 'Customer entered the wrong M-Pesa PIN'
    default:   return 'Payment could not be completed — please ask customer to try again'
  }
}

export default router
