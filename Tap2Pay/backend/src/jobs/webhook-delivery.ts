/**
 * jobs/webhook-delivery.ts — HTTP delivery of queued webhook events.
 *
 * runWebhookDeliveryJob():
 *   Picks up to 50 PENDING webhook_deliveries (attempt < 5), posts each to the
 *   registered URL with an HMAC-SHA256 signature, and updates the row status.
 *
 * enqueueWebhookEvent(merchantId, event, payload):
 *   Fire-and-forget helper called from route handlers (e.g. mpesa-callback).
 *   Finds active webhooks for the merchant that subscribe to the event and
 *   inserts one webhook_deliveries row per matching webhook.
 *
 * Retry policy:
 *   - Up to 5 attempts (attempt 0 → 4).
 *   - On non-2xx or network error: increment attempt, store last_error.
 *   - After the 5th failure (attempt reaches 5): set status = 'FAILED'.
 *   - On 2xx: set status = 'DELIVERED', delivered_at = NOW().
 *
 * Signature:
 *   X-Orchestratepay-Signature: sha256=<HMAC-SHA256(secret, JSON.stringify(payload))>
 *   X-Orchestratepay-Event: <event name>
 */
import crypto from 'crypto'
import { db } from '../db/index'
import { logger } from '../util/logger'

const DELIVERY_TIMEOUT_MS = 10_000   // 10 s per attempt
const MAX_ATTEMPTS        = 5
const BATCH_SIZE          = 50

// ─── runWebhookDeliveryJob ────────────────────────────────────────────────────

export async function runWebhookDeliveryJob(): Promise<void> {
  logger.info('Webhook delivery job starting')

  let delivered = 0, failed = 0, retried = 0

  try {
    // Fetch pending deliveries with their webhook URL and secret in one round-trip
    const { rows } = await db.query(
      `SELECT
         d.id,
         d.webhook_id  AS "webhookId",
         d.event,
         d.payload,
         d.attempt,
         w.url,
         w.secret,
         w.active      AS "webhookActive"
       FROM webhook_deliveries d
       JOIN merchant_webhooks  w ON w.id = d.webhook_id
       WHERE d.status = 'PENDING' AND d.attempt < $1
       ORDER BY d.created_at ASC
       LIMIT $2`,
      [MAX_ATTEMPTS, BATCH_SIZE]
    )

    logger.info('Webhook delivery job: found pending deliveries', { count: rows.length })

    for (const row of rows) {
      // Skip if the webhook has been deactivated since the event was enqueued
      if (!row.webhookActive) {
        logger.info('Webhook delivery skipped — webhook inactive', {
          deliveryId: row.id,
          webhookId:  row.webhookId,
        })
        continue
      }

      const payloadBody = JSON.stringify(row.payload)
      const signature   = 'sha256=' +
        crypto.createHmac('sha256', row.secret).update(payloadBody).digest('hex')

      let responseStatus: number | null = null
      let errorMessage: string | null   = null

      try {
        const controller = new AbortController()
        const timer      = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

        try {
          const response = await fetch(row.url, {
            method:  'POST',
            headers: {
              'Content-Type':                   'application/json',
              'X-Orchestratepay-Signature':     signature,
              'X-Orchestratepay-Event':         row.event,
            },
            body:   payloadBody,
            signal: controller.signal,
          })
          responseStatus = response.status
        } finally {
          clearTimeout(timer)
        }
      } catch (fetchErr: unknown) {
        errorMessage = (fetchErr as Error).message ?? 'Network error'
      }

      const success = responseStatus !== null && responseStatus >= 200 && responseStatus < 300

      if (success) {
        await db.query(
          `UPDATE webhook_deliveries
           SET status = 'DELIVERED', delivered_at = NOW(), attempt = attempt + 1
           WHERE id = $1`,
          [row.id]
        )
        delivered++
        logger.info('Webhook delivered', {
          deliveryId: row.id,
          webhookId:  row.webhookId,
          event:      row.event,
          status:     responseStatus,
        })
      } else {
        // Determine if this is the last allowed attempt
        const nextAttempt   = row.attempt + 1
        const terminalFail  = nextAttempt >= MAX_ATTEMPTS
        const errMsg        = errorMessage ?? `HTTP ${responseStatus}`

        await db.query(
          `UPDATE webhook_deliveries
           SET attempt    = $1,
               last_error = $2,
               status     = $3
           WHERE id = $4`,
          [
            nextAttempt,
            errMsg,
            terminalFail ? 'FAILED' : 'PENDING',
            row.id,
          ]
        )

        if (terminalFail) {
          failed++
          logger.warn('Webhook delivery permanently failed', {
            deliveryId: row.id,
            webhookId:  row.webhookId,
            event:      row.event,
            error:      errMsg,
          })
        } else {
          retried++
          logger.info('Webhook delivery attempt failed — will retry', {
            deliveryId: row.id,
            webhookId:  row.webhookId,
            event:      row.event,
            attempt:    nextAttempt,
            error:      errMsg,
          })
        }
      }
    }

    logger.info('Webhook delivery job completed', { delivered, failed, retried })

  } catch (err: unknown) {
    logger.error('Webhook delivery job failed', { error: (err as Error).message })
  }
}

// ─── enqueueWebhookEvent ──────────────────────────────────────────────────────
// Fire-and-forget: called from route handlers after a payment event occurs.
// Finds every active webhook for the merchant that subscribes to this event,
// then inserts one webhook_deliveries row per match.

export async function enqueueWebhookEvent(
  merchantId: string,
  event:      string,
  payload:    object
): Promise<void> {
  try {
    // Find active webhooks subscribed to this event type
    const { rows } = await db.query(
      `SELECT id FROM merchant_webhooks
       WHERE merchant_id = $1
         AND active = TRUE
         AND $2 = ANY(events)`,
      [merchantId, event]
    )

    if (rows.length === 0) return

    const fullPayload = JSON.stringify({ event, ...payload })

    for (const webhook of rows) {
      try {
        await db.query(
          `INSERT INTO webhook_deliveries (webhook_id, event, payload, status, attempt)
           VALUES ($1, $2, $3, 'PENDING', 0)`,
          [webhook.id, event, fullPayload]
        )
      } catch (insertErr: unknown) {
        logger.warn('Failed to enqueue webhook delivery for one webhook', {
          merchantId,
          webhookId: webhook.id,
          event,
          error: (insertErr as Error).message,
        })
      }
    }

    logger.info('Webhook events enqueued', {
      merchantId,
      event,
      count: rows.length,
    })
  } catch (err: unknown) {
    // Fire-and-forget: never propagate errors to the caller
    logger.warn('enqueueWebhookEvent failed silently', {
      merchantId,
      event,
      error: (err as Error).message,
    })
  }
}
