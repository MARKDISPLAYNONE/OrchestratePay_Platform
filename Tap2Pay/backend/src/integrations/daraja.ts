/**
 * daraja.ts — M-Pesa Daraja API integration.
 *
 * Covers:
 *   1. OAuth token management (with Redis caching)
 *   2. STK Push (Lipa Na M-Pesa Online)
 *   3. STK Query (check the status of a previous push)
 *
 * IMPORTANT ENVIRONMENT DIFFERENCES:
 *   Sandbox: api.safaricom.co.ke  (use test credentials from developer.safaricom.co.ke)
 *   Production: api.safaricom.co.ke  (use live credentials from Safaricom Business)
 *
 * Both use the same base URL — the environment is determined by which
 * Consumer Key/Secret you use.
 */
import axios from 'axios'
import { redis } from '../db/redis'
import { logger } from '../util/logger'
import { CircuitBreaker, CircuitOpenError } from '../util/circuit-breaker'

// Set DARAJA_ENV=production in .env to switch from sandbox to live credentials.
// All other code paths (endpoints, passkey, shortcode) stay the same — only the
// base URL and credentials differ between environments.
const DARAJA_BASE = process.env.DARAJA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

const OAUTH_URL       = `${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`
const STK_URL         = `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`
const QUERY_URL       = `${DARAJA_BASE}/mpesa/stkpushquery/v1/query`
const B2C_URL         = `${DARAJA_BASE}/mpesa/b2c/v3/paymentrequest`
const REDIS_TOKEN_KEY = 'daraja:access_token'

// Circuit breaker: open after 5 consecutive Daraja failures, reset after 30s.
// When OPEN, stkPush returns { success: false } immediately instead of hanging
// for 30 seconds waiting for a timeout — critical for merchant UX on slow 3G.
const darajaCircuit = new CircuitBreaker('daraja-api', 5, 30_000)

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface StkPushRequest {
  phoneNumber: string    // consumer's Safaricom number (254XXXXXXXXX)
  amount: number         // KSh (whole number — M-Pesa doesn't accept cents)
  accountRef: string     // what appears on consumer's phone (max 12 chars)
  description: string    // transaction description (max 13 chars)
  callbackUrl: string    // Safaricom will POST the result here
}

export interface StkPushResult {
  success: boolean
  merchantRequestId?: string
  checkoutRequestId?: string
  errorMessage?: string
}

export interface StkQueryResult {
  resultCode: number
  resultDesc: string
  mpesaReceiptNumber?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getAccessToken — fetches a Bearer token from Daraja, with Redis caching.
 *
 * Daraja tokens expire in 3600 seconds (1 hour). We cache in Redis with
 * a TTL of 3500 seconds to give 100s of headroom before expiry.
 *
 * WHY CACHE: Daraja rate-limits token requests. During a busy period
 * (e.g. 50 merchants each with a payment in flight), without caching
 * we'd hit the rate limit and fail to initiate payments.
 */
async function getAccessToken(): Promise<string> {
  // Check Redis cache first
  const cached = await redis.get(REDIS_TOKEN_KEY)
  if (cached) {
    logger.debug('Using cached Daraja access token')
    return cached
  }

  // Fetch a new token
  const credentials = Buffer.from(
    `${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`
  ).toString('base64')

  const response = await axios.get(OAUTH_URL, {
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 10_000  // 10 s — Daraja must respond before the circuit breaker can fire
  })

  const token: string = response.data.access_token
  const expiresIn: number = parseInt(response.data.expires_in) || 3600

  // Cache with a TTL 100s shorter than actual expiry to avoid using a stale token
  await redis.setex(REDIS_TOKEN_KEY, expiresIn - 100, token)
  logger.info('Fetched new Daraja access token', { expiresIn })

  return token
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generatePassword — creates the STK Push password for this specific moment.
 *
 * Formula: Base64(BusinessShortCode + Passkey + Timestamp)
 * Timestamp format: YYYYMMDDHHmmss
 *
 * The timestamp is part of the password, so a password generated at 14:30
 * cannot be replayed at 14:31. This is Safaricom's replay-protection mechanism.
 * It means we must generate a fresh password for each STK Push request.
 */
function generatePassword(): { password: string; timestamp: string } {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')  // remove everything non-numeric
    .slice(0, 14)             // take first 14 digits: YYYYMMDDHHmmss

  const raw = `${process.env.DARAJA_SHORTCODE}${process.env.DARAJA_PASSKEY}${timestamp}`
  const password = Buffer.from(raw).toString('base64')

  return { password, timestamp }
}

// ─────────────────────────────────────────────────────────────────────────────
// STK PUSH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * stkPush — sends a Lipa Na M-Pesa Online payment request.
 *
 * This causes the consumer's phone to display a PIN prompt.
 * The actual payment confirmation comes asynchronously via the callback URL.
 *
 * PHONE NUMBER FORMAT: Must be 254XXXXXXXXX (no +, no 0 prefix, no spaces).
 * We normalise the number before sending.
 *
 * AMOUNT: Safaricom requires a whole number (no decimals). If amountCents
 * from the app is 50050, we pass 500 (ceil division, round up to protect merchant).
 */
export async function stkPush(req: StkPushRequest): Promise<StkPushResult> {
  try {
    return await darajaCircuit.fire(async () => {
      const token = await getAccessToken()
      const { password, timestamp } = generatePassword()
      const phone = normalisePhone(req.phoneNumber)

      logger.info('Initiating STK Push', {
        phone: maskPhone(phone),
        amount: req.amount,
        ref: req.accountRef
      })

      const response = await axios.post(STK_URL, {
        BusinessShortCode: process.env.DARAJA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.ceil(req.amount),
        PartyA: phone,
        PartyB: process.env.DARAJA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: req.callbackUrl,
        AccountReference: req.accountRef.slice(0, 12),
        TransactionDesc: req.description.slice(0, 13)
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15_000  // 15 s — STK Push must complete before the circuit breaker fires
      })

      const data = response.data
      if (data.ResponseCode !== '0') {
        logger.warn('STK Push declined by Daraja', { response: data })
        return { success: false, errorMessage: data.ResponseDescription }
      }

      return {
        success: true,
        merchantRequestId: data.MerchantRequestID,
        checkoutRequestId: data.CheckoutRequestID
      }
    })

  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      logger.warn('STK Push blocked — Daraja circuit open')
      return {
        success: false,
        errorMessage: 'M-Pesa service temporarily unavailable — please try again in 30 seconds'
      }
    }
    const axiosErr = err as { response?: { data?: { errorMessage?: string } }; message?: string }
    const msg = axiosErr.response?.data?.errorMessage || axiosErr.message
    logger.error('STK Push API error', { error: msg })
    return { success: false, errorMessage: msg }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STK QUERY (reconciliation tool)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * stkQuery — asks Safaricom what happened to a previous STK Push.
 *
 * Used by the reconciliation job when a callback was never received.
 * Returns the result code (0 = success) so we can update stuck PENDING transactions.
 *
 * Result codes you'll see:
 *   0    = Success
 *   1    = Insufficient funds
 *   1032 = Request cancelled by user
 *   1037 = DS timeout user cannot be reached
 *   2001 = Wrong PIN
 *   500  = Internal server error / still processing (do not finalize)
 */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  try {
    return await darajaCircuit.fire(async () => {
      const token = await getAccessToken()
      const { password, timestamp } = generatePassword()

      const response = await axios.post(QUERY_URL, {
        BusinessShortCode: process.env.DARAJA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15_000  // 15 s — query must complete; reconciliation retries on failure
      })

      const data = response.data
      return {
        resultCode: parseInt(data.ResultCode),
        resultDesc: data.ResultDesc,
        mpesaReceiptNumber: undefined  // query doesn't return receipt — only callback does
      }
    })

  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      // Return -1 so the reconciliation job skips this transaction and retries next run
      logger.warn('STK Query blocked — Daraja circuit open', { checkoutRequestId })
      return { resultCode: -1, resultDesc: 'Circuit open — will retry' }
    }
    logger.error('STK Query error', { checkoutRequestId, error: (err as Error).message })
    return { resultCode: -1, resultDesc: 'Query failed' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT STATUS — for admin monitoring endpoint
// ─────────────────────────────────────────────────────────────────────────────

export function getDarajaCircuitStatus(): {
  state: string
  failureCount: number
} {
  return {
    state:        darajaCircuit.status,
    failureCount: darajaCircuit.failureCount
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * normalisePhone — converts any common Kenyan phone format to 254XXXXXXXXX.
 *
 * Accepts: 0712345678, +254712345678, 254712345678, 712345678
 * Rejects: non-Safaricom prefixes (returns as-is, Daraja will reject)
 */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')  // strip all non-digits

  if (digits.startsWith('254') && digits.length === 12) return digits
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1)
  if (digits.length === 9) return '254' + digits

  return digits  // return unchanged if unrecognised — Daraja will reject with a clear error
}

/** maskPhone — for logging (show first 5 and last 2 digits only) */
function maskPhone(phone: string): string {
  return phone.length >= 7
    ? phone.slice(0, 5) + '****' + phone.slice(-2)
    : '****'
}

export interface B2cPayoutRequest {
  refundId:       string   // correlation ID (refundId or settlementId)
  merchantId:     string
  amountCents:    number
  recipientPhone: string   // 254XXXXXXXXX — consumer or merchant phone
}

export interface B2cPayoutResult {
  requestId: string
}

/**
 * initiateB2cPayout — trigger an M-Pesa Business-to-Customer payment.
 *
 * Used for both refunds (consumer receives money) and merchant settlements
 * (merchant M-Pesa account receives float).
 *
 * Required env vars:
 *   DARAJA_B2C_INITIATOR_NAME      — API operator username from Safaricom portal
 *   DARAJA_B2C_SECURITY_CREDENTIAL — RSA-encrypted initiator password
 *                                    (generate: openssl rsautl -encrypt -pubin -inkey
 *                                     SafaricomCert.cer -in plain.txt | base64)
 *   DARAJA_B2C_RESULT_URL          — HTTPS URL for Safaricom to POST results
 *   DARAJA_B2C_TIMEOUT_URL         — HTTPS URL for Safaricom to POST timeouts
 *
 * Throws if credentials are missing — the caller transitions the record to FAILED.
 */
export async function initiateB2cPayout(params: B2cPayoutRequest): Promise<B2cPayoutResult> {
  const initiatorName       = process.env.DARAJA_B2C_INITIATOR_NAME
  const securityCredential  = process.env.DARAJA_B2C_SECURITY_CREDENTIAL
  const resultUrl           = process.env.DARAJA_B2C_RESULT_URL
  const timeoutUrl          = process.env.DARAJA_B2C_TIMEOUT_URL

  if (!initiatorName || !securityCredential || !resultUrl || !timeoutUrl) {
    throw new Error(
      'B2C payout not configured — set DARAJA_B2C_INITIATOR_NAME, ' +
      'DARAJA_B2C_SECURITY_CREDENTIAL, DARAJA_B2C_RESULT_URL, DARAJA_B2C_TIMEOUT_URL'
    )
  }

  const token = await getAccessToken()
  const phone = normalisePhone(params.recipientPhone)
  const amountKes = Math.ceil(params.amountCents / 100)  // M-Pesa takes whole KSh

  // OriginatorConversationID must be unique per request (max 12 chars in sandbox).
  // We use the first 12 chars of the refundId (UUID without dashes is 32 hex chars).
  const originatorId = params.refundId.replace(/-/g, '').slice(0, 12)

  logger.info('Initiating B2C payout', {
    refundId:   params.refundId,
    merchantId: params.merchantId,
    phone:      maskPhone(phone),
    amountKes,
  })

  const response = await axios.post(B2C_URL, {
    OriginatorConversationID: originatorId,
    InitiatorName:            initiatorName,
    SecurityCredential:       securityCredential,
    CommandID:                'BusinessPayment',
    Amount:                   amountKes,
    PartyA:                   process.env.DARAJA_SHORTCODE,
    PartyB:                   phone,
    Remarks:                  `OrchestratePay payout ${params.refundId.slice(0, 8)}`,
    QueueTimeOutURL:          timeoutUrl,
    ResultURL:                resultUrl,
    Occasion:                 '',
  }, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  })

  const data = response.data
  if (data.ResponseCode !== '0') {
    logger.warn('B2C payout rejected by Daraja', { response: data, refundId: params.refundId })
    throw new Error(`Daraja B2C rejected: ${data.ResponseDescription}`)
  }

  logger.info('B2C payout accepted by Daraja', {
    refundId:               params.refundId,
    originatorConversationId: data.OriginatorConversationID,
    conversationId:           data.ConversationID,
  })

  return { requestId: data.OriginatorConversationID ?? originatorId }
}
