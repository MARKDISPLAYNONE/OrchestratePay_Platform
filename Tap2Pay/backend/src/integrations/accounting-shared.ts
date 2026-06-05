/**
 * accounting-shared.ts — Types and helpers shared across all accounting integrations.
 */
import { logger } from '../util/logger'

export interface GlPostingPayload {
  transactionId:  string
  merchantId:     string
  amountCents:    number
  currency:       string
  description:    string
  journalDate:    string  // YYYY-MM-DD
  mpesaReceipt?:  string
}

export interface GlPostingResult {
  success:     boolean
  externalId?: string
  error?:      string
}

export interface OAuthTokenParams {
  tokenUrl:     string
  clientId:     string
  clientSecret: string
  refreshToken: string
  platform:     string
}

/**
 * Generic OAuth 2.0 refresh_token grant. Used by all four accounting platforms.
 * Returns null on failure — callers must handle missing tokens gracefully.
 */
export async function refreshOAuthToken(params: OAuthTokenParams): Promise<{
  accessToken:  string
  refreshToken: string
  expiresAt:    Date
} | null> {
  const { tokenUrl, clientId, clientSecret, refreshToken, platform } = params

  if (!clientId || !clientSecret) {
    logger.warn(`${platform} OAuth credentials not configured — token refresh skipped`)
    return null
  }

  try {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    })

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(tokenUrl, {
      method:  'POST',
      headers: {
        Authorization:  `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:         'application/json',
      },
      body:   body.toString(),
      signal: AbortSignal.timeout(10_000),
    })

    const json = await res.json().catch(() => ({})) as any

    if (!res.ok || !json.access_token) {
      logger.warn(`${platform} token refresh failed`, { status: res.status, error: json.error })
      return null
    }

    const expiresIn = json.expires_in ?? 3600
    const expiresAt = new Date(Date.now() + expiresIn * 1000)

    return {
      accessToken:  json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt,
    }
  } catch (err: any) {
    logger.error(`${platform} token refresh threw`, { error: err.message })
    return null
  }
}
