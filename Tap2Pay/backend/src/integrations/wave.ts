/**
 * wave.ts — Wave Accounting GL posting via Wave GraphQL API.
 *
 * Docs: https://developer.waveapps.com/hc/en-us/articles/360019993212
 *
 * Wave uses GraphQL (unlike the REST APIs of the other platforms).
 * Wave does not support OAuth refresh tokens in the same way — the API key
 * is stored directly as `access_token` in accounting_integrations.
 *
 * Mutation: moneyTransactionCreate
 */
import { logger } from '../util/logger'
import { GlPostingPayload, GlPostingResult } from './accounting-shared'

const WAVE_GRAPHQL_URL = 'https://gql.waveapps.com/graphql/public'

const CREATE_TRANSACTION_MUTATION = `
  mutation CreateTransaction($input: MoneyTransactionCreateInput!) {
    moneyTransactionCreate(input: $input) {
      didSucceed
      inputErrors { code message path }
      transaction { id }
    }
  }
`

export async function postToWave(
  payload: GlPostingPayload,
  accessToken: string,
  businessId: string,
  settings: Record<string, any>
): Promise<GlPostingResult> {
  const anchorAccountId   = settings.anchorAccountId   // Wave requires a specific account ID (UUID)
  const revenueAccountId  = settings.revenueAccountId

  if (!anchorAccountId || !revenueAccountId) {
    return {
      success: false,
      error:   'Wave integration requires anchorAccountId and revenueAccountId in settings',
    }
  }

  const amountKsh = (payload.amountCents / 100).toFixed(2)

  const input = {
    businessId,
    externalId:  payload.transactionId,
    date:        payload.journalDate,
    description: payload.description,
    anchor: {
      accountId:  anchorAccountId,
      amount:     amountKsh,
      direction: 'DEPOSIT',
    },
    lineItems: [
      {
        accountId: revenueAccountId,
        amount:    amountKsh,
        balance:   'DECREASE',
      },
    ],
  }

  try {
    const res = await fetch(WAVE_GRAPHQL_URL, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify({ query: CREATE_TRANSACTION_MUTATION, variables: { input } }),
      signal: AbortSignal.timeout(15_000),
    })

    const json = await res.json().catch(() => ({})) as any
    const result = json?.data?.moneyTransactionCreate

    if (result?.didSucceed && result?.transaction?.id) {
      logger.info('Wave transaction posted', {
        txnId:      payload.transactionId,
        externalId: result.transaction.id,
      })
      return { success: true, externalId: result.transaction.id }
    }

    const inputErrors = result?.inputErrors?.map((e: any) => e.message).join('; ')
    const errMsg = inputErrors ?? json?.errors?.[0]?.message ?? `HTTP ${res.status}`
    logger.warn('Wave posting failed', { txnId: payload.transactionId, error: errMsg })
    return { success: false, error: errMsg }

  } catch (err: any) {
    logger.error('Wave POST threw', { txnId: payload.transactionId, error: err.message })
    return { success: false, error: err.message }
  }
}
