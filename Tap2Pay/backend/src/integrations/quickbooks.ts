/**
 * quickbooks.ts — QuickBooks Online GL posting via Intuit API.
 *
 * Docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/journalentry
 *
 * Auth: OAuth 2.0 (access_token + refresh_token stored in accounting_integrations).
 * Token refresh is handled by refreshTokenIfNeeded() before each API call.
 *
 * Posting strategy:
 *   DR  1200 (Accounts Receivable / M-Pesa)    → amountCents / 100
 *   CR  4000 (Sales Revenue)                   → amountCents / 100
 *
 * Account codes are configurable per-merchant via accounting_integrations.settings.
 */
import { logger } from '../util/logger'
import { GlPostingPayload, GlPostingResult, refreshOAuthToken } from './accounting-shared'

const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const QBO_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company'

export async function postToQuickBooks(
  payload: GlPostingPayload,
  accessToken: string,
  realmId: string,
  settings: Record<string, unknown>
): Promise<GlPostingResult> {
  const base = process.env.QBO_SANDBOX === 'true' ? QBO_SANDBOX_BASE : QBO_API_BASE
  const url  = `${base}/${realmId}/journalentry`

  const debitAccount  = (settings.debitAccount  as string | undefined) ?? '57'   // QBO default: A/R account
  const creditAccount = (settings.creditAccount as string | undefined) ?? '79'   // QBO default: Sales account
  const amountKsh     = payload.amountCents / 100

  const body = {
    DocNumber:   payload.transactionId.slice(0, 20),
    TxnDate:     payload.journalDate,
    PrivateNote: payload.description,
    Line: [
      {
        JournalEntryLineDetail: {
          PostingType:     'Debit',
          AccountRef: { value: debitAccount },
        },
        Amount:      amountKsh,
        DetailType: 'JournalEntryLineDetail',
        Description: payload.description,
      },
      {
        JournalEntryLineDetail: {
          PostingType:     'Credit',
          AccountRef: { value: creditAccount },
        },
        Amount:      amountKsh,
        DetailType: 'JournalEntryLineDetail',
        Description: payload.description,
      },
    ],
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body:   JSON.stringify({ JournalEntry: body }),
      signal: AbortSignal.timeout(15_000),
    })

    const json = await res.json().catch(() => ({})) as {
      JournalEntry?: { Id?: unknown }
      Fault?: { Error?: Array<{ Message?: string }> }
    }

    if (res.ok && json?.JournalEntry?.Id) {
      logger.info('QuickBooks journal entry posted', {
        txnId:      payload.transactionId,
        externalId: json.JournalEntry.Id,
      })
      return { success: true, externalId: String(json.JournalEntry.Id) }
    }

    const errMsg = json?.Fault?.Error?.[0]?.Message ?? `HTTP ${res.status}`
    logger.warn('QuickBooks posting failed', { txnId: payload.transactionId, error: errMsg })
    return { success: false, error: errMsg }

  } catch (err: unknown) {
    logger.error('QuickBooks POST threw', { txnId: payload.transactionId, error: (err as Error).message })
    return { success: false, error: (err as Error).message }
  }
}

export async function refreshQuickBooksToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
} | null> {
  return refreshOAuthToken({
    tokenUrl:     'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    clientId:     process.env.QBO_CLIENT_ID ?? '',
    clientSecret: process.env.QBO_CLIENT_SECRET ?? '',
    refreshToken,
    platform:     'quickbooks',
  })
}
