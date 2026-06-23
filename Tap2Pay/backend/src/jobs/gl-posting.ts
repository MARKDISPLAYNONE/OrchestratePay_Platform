/**
 * gl-posting.ts — Deferred GL posting job.
 *
 * After a CONFIRMED transaction, mpesa-callback.ts calls enqueueGlPosting()
 * which writes a PENDING row to gl_postings. This job runs every 2 minutes
 * and drains pending rows, retrying failed ones with exponential back-off.
 *
 * Design principles:
 *   - Idempotent: posting the same gl_postings row twice must not double-post.
 *     We store external_id and check status before re-posting.
 *   - Non-fatal: a GL posting failure must NEVER reverse or block the payment.
 *   - Max retries: 5. After that, status → FAILED, ops gets alerted.
 *   - Token refresh: if access_token is expired, refresh it and retry once.
 */
import { db }    from '../db/index'
import { logger } from '../util/logger'

import { postToQuickBooks, refreshQuickBooksToken } from '../integrations/quickbooks'
import { postToXero,       refreshXeroToken       } from '../integrations/xero'
import { postToSage,       refreshSageToken       } from '../integrations/sage'
import { postToWave                               } from '../integrations/wave'
import type { GlPostingPayload }                    from '../integrations/accounting-shared'

const MAX_RETRIES = 5

/**
 * Enqueues a GL posting for a CONFIRMED transaction.
 * Called fire-and-forget from mpesa-callback.ts after status = CONFIRMED.
 */
export async function enqueueGlPosting(
  transactionId: string,
  merchantId: string,
  amountCents: number,
  currency: string,
  mpesaReceipt: string,
  journalDate: string
): Promise<void> {
  // Find active integrations for this merchant
  const { rows: integrations } = await db.query(
    `SELECT id, platform FROM accounting_integrations
     WHERE merchant_id = $1 AND status = 'ACTIVE'`,
    [merchantId]
  )

  if (integrations.length === 0) return  // no integrations connected

  const description = `OrchestratePay M-Pesa ${mpesaReceipt} — KSh ${(amountCents / 100).toFixed(2)}`

  for (const integration of integrations) {
    await db.query(
      `INSERT INTO gl_postings
         (accounting_integration_id, merchant_id, transaction_id, platform,
          status, debit_account, credit_account, amount_cents, currency,
          description, journal_date)
       VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [
        integration.id, merchantId, transactionId, integration.platform,
        'MPESA_RECEIVABLE', 'SALES_REVENUE',
        amountCents, currency, description, journalDate,
      ]
    ).catch((err: Error) => {
      logger.error('Failed to enqueue GL posting', { transactionId, platform: integration.platform, error: err.message })
    })
  }
}

/**
 * Drains pending GL postings. Called by 2-minute cron in index.ts.
 */
export async function runGlPostingJob(): Promise<void> {
  const { rows: pending } = await db.query(`
    SELECT
      gp.id, gp.accounting_integration_id, gp.platform,
      gp.transaction_id, gp.merchant_id, gp.amount_cents, gp.currency,
      gp.description, gp.journal_date, gp.attempt_count,
      ai.access_token, ai.refresh_token, ai.token_expires_at,
      ai.realm_id, ai.settings
    FROM gl_postings gp
    JOIN accounting_integrations ai ON ai.id = gp.accounting_integration_id
    WHERE gp.status = 'PENDING' AND gp.attempt_count < $1
    ORDER BY gp.created_at ASC
    LIMIT 50
  `, [MAX_RETRIES])

  if (pending.length === 0) return

  logger.info('GL posting job started', { count: pending.length })

  for (const row of pending) {
    await processPosting(row)
  }
}

interface GlPostingRow {
  id:                       string
  accounting_integration_id: string
  platform:                 string
  transaction_id:           string
  merchant_id:              string
  amount_cents:             number
  currency:                 string
  description:              string
  journal_date:             string
  attempt_count:            number
  access_token:             string
  refresh_token:            string
  token_expires_at:         string | null
  realm_id:                 string
  settings:                 Record<string, unknown> | null
}

async function processPosting(row: GlPostingRow): Promise<void> {
  const payload: GlPostingPayload = {
    transactionId: row.transaction_id,
    merchantId:    row.merchant_id,
    amountCents:   row.amount_cents,
    currency:      row.currency,
    description:   row.description,
    journalDate:   row.journal_date,
  }

  // Increment attempt before calling — so a crash still counts as an attempt
  await db.query(
    `UPDATE gl_postings SET attempt_count = attempt_count + 1 WHERE id = $1`,
    [row.id]
  )

  let { access_token: accessToken, refresh_token: refreshToken } = row
  const realmId: string = row.realm_id
  const settings  = row.settings ?? {}
  const tokenExpiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null

  // Refresh token if expired (or within 5 min of expiry)
  if (tokenExpiresAt && tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshToken_(row.platform, refreshToken)
    if (refreshed) {
      accessToken  = refreshed.accessToken
      refreshToken = refreshed.refreshToken
      await db.query(
        `UPDATE accounting_integrations
         SET access_token = $1, refresh_token = $2, token_expires_at = $3
         WHERE id = $4`,
        [refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt, row.accounting_integration_id]
      ).catch(() => {})
    }
  }

  let result
  switch (row.platform) {
    case 'quickbooks':
      result = await postToQuickBooks(payload, accessToken, realmId, settings)
      break
    case 'xero':
      result = await postToXero(payload, accessToken, realmId, settings)
      break
    case 'sage':
      result = await postToSage(payload, accessToken, realmId, settings)
      break
    case 'wave':
      result = await postToWave(payload, accessToken, realmId, settings)
      break
    default:
      logger.error('Unknown accounting platform', { platform: row.platform, glPostingId: row.id })
      await db.query(
        `UPDATE gl_postings SET status='FAILED', last_error='Unknown platform' WHERE id=$1`,
        [row.id]
      )
      return
  }

  if (result.success) {
    await db.query(
      `UPDATE gl_postings
       SET status = 'POSTED', external_id = $1, posted_at = NOW(), last_error = NULL
       WHERE id = $2`,
      [result.externalId ?? null, row.id]
    )
    await db.query(
      `UPDATE accounting_integrations SET last_sync_at = NOW() WHERE id = $1`,
      [row.accounting_integration_id]
    ).catch(() => {})
  } else {
    const isFinal = (row.attempt_count + 1) >= MAX_RETRIES
    await db.query(
      `UPDATE gl_postings
       SET status = $1, last_error = $2
       WHERE id = $3`,
      [isFinal ? 'FAILED' : 'PENDING', result.error ?? 'Unknown error', row.id]
    )
    if (isFinal) {
      logger.error('GL posting permanently failed after max retries', {
        glPostingId: row.id,
        platform:    row.platform,
        txnId:       row.transaction_id,
        error:       result.error,
      })
    }
  }
}

async function refreshToken_(platform: string, refreshToken: string) {
  switch (platform) {
    case 'quickbooks': return refreshQuickBooksToken(refreshToken)
    case 'xero':       return refreshXeroToken(refreshToken)
    case 'sage':       return refreshSageToken(refreshToken)
    default:           return null  // Wave uses API keys, not refresh tokens
  }
}
