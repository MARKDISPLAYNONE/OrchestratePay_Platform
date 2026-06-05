/**
 * sage.ts — Sage Business Cloud Accounting GL posting.
 *
 * Docs: https://developer.sage.com/accounting/reference/journals/
 *
 * Sage uses "journal_entry" with debit/credit line items.
 * Account ledger codes are configurable per-merchant via settings.
 */
import { logger } from '../util/logger'
import { GlPostingPayload, GlPostingResult, refreshOAuthToken } from './accounting-shared'

const SAGE_API_BASE = 'https://api.accounting.sage.com/v3.1'

export async function postToSage(
  payload: GlPostingPayload,
  accessToken: string,
  _realmId: string,
  settings: Record<string, any>
): Promise<GlPostingResult> {
  const url = `${SAGE_API_BASE}/journals`

  const debitLedger  = settings.debitLedgerCode  ?? 'DEBTORS'
  const creditLedger = settings.creditLedgerCode ?? 'SALES'
  const amountKsh    = payload.amountCents / 100

  const body = {
    journal: {
      date:        payload.journalDate,
      description: payload.description,
      journal_lines: [
        {
          ledger_account: { display_id: debitLedger },
          debit:  amountKsh,
          credit: 0,
          description: payload.description,
        },
        {
          ledger_account: { display_id: creditLedger },
          debit:  0,
          credit: amountKsh,
          description: payload.description,
        },
      ],
    },
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body:   JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })

    const json = await res.json().catch(() => ({})) as any

    if (res.ok && json?.id) {
      logger.info('Sage journal posted', {
        txnId:      payload.transactionId,
        externalId: json.id,
      })
      return { success: true, externalId: String(json.id) }
    }

    const errMsg = json?.message ?? `HTTP ${res.status}`
    logger.warn('Sage posting failed', { txnId: payload.transactionId, error: errMsg })
    return { success: false, error: errMsg }

  } catch (err: any) {
    logger.error('Sage POST threw', { txnId: payload.transactionId, error: err.message })
    return { success: false, error: err.message }
  }
}

export async function refreshSageToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
} | null> {
  return refreshOAuthToken({
    tokenUrl:     'https://oauth.accounting.sage.com/token',
    clientId:     process.env.SAGE_CLIENT_ID ?? '',
    clientSecret: process.env.SAGE_CLIENT_SECRET ?? '',
    refreshToken,
    platform:     'sage',
  })
}
