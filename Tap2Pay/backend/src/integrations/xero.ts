/**
 * xero.ts — Xero Accounting GL posting via Xero API v2.
 *
 * Docs: https://developer.xero.com/documentation/api/accounting/manualjournals
 *
 * Posting strategy (same DR/CR structure as QuickBooks):
 *   DR  200 (Debtors / M-Pesa Clearing)  → amount
 *   CR  400 (Sales)                       → amount
 *
 * Account codes are configurable via accounting_integrations.settings.
 * Xero uses account codes (e.g. '200') not numeric IDs.
 */
import { logger } from '../util/logger'
import { GlPostingPayload, GlPostingResult, refreshOAuthToken } from './accounting-shared'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

export async function postToXero(
  payload: GlPostingPayload,
  accessToken: string,
  tenantId: string,
  settings: Record<string, unknown>
): Promise<GlPostingResult> {
  const url = `${XERO_API_BASE}/ManualJournals`

  const debitCode  = (settings.debitAccountCode  as string | undefined) ?? '200'
  const creditCode = (settings.creditAccountCode as string | undefined) ?? '400'
  const amountKsh  = payload.amountCents / 100

  const body = {
    Narration:   payload.description,
    Date:        payload.journalDate,
    JournalLines: [
      {
        AccountCode:   debitCode,
        LineAmount:    amountKsh,
        Description:   payload.description,
      },
      {
        AccountCode:   creditCode,
        LineAmount:    -amountKsh,
        Description:   payload.description,
      },
    ],
  }

  try {
    const res = await fetch(url, {
      method:  'PUT',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Xero-tenant-id': tenantId,
        'Content-Type':   'application/json',
        Accept:           'application/json',
      },
      body:   JSON.stringify({ ManualJournals: [body] }),
      signal: AbortSignal.timeout(15_000),
    })

    const json = await res.json().catch(() => ({})) as {
      ManualJournals?: Array<{ ManualJournalID?: string }>
      Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>
    }
    const entry = json?.ManualJournals?.[0]

    if (res.ok && entry?.ManualJournalID) {
      logger.info('Xero manual journal posted', {
        txnId:      payload.transactionId,
        externalId: entry.ManualJournalID,
      })
      return { success: true, externalId: entry.ManualJournalID }
    }

    const errMsg = json?.Elements?.[0]?.ValidationErrors?.[0]?.Message ?? `HTTP ${res.status}`
    logger.warn('Xero posting failed', { txnId: payload.transactionId, error: errMsg })
    return { success: false, error: errMsg }

  } catch (err: unknown) {
    logger.error('Xero PUT threw', { txnId: payload.transactionId, error: (err as Error).message })
    return { success: false, error: (err as Error).message }
  }
}

export async function refreshXeroToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
} | null> {
  return refreshOAuthToken({
    tokenUrl:     'https://identity.xero.com/connect/token',
    clientId:     process.env.XERO_CLIENT_ID ?? '',
    clientSecret: process.env.XERO_CLIENT_SECRET ?? '',
    refreshToken,
    platform:     'xero',
  })
}
