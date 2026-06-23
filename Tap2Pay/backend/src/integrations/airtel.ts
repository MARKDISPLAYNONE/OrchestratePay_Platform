/**
 * airtel.ts — Airtel Money Kenya/Africa payment collection integration.
 *
 * Airtel Africa Merchant API v2:
 *   Base URL: https://openapi.airtel.africa
 *   Auth:     POST /auth/oauth2/token (client_credentials grant)
 *   Payment:  POST /merchant/v2/payments/
 *   Enquiry:  GET  /standard/v1/payments/{id}
 *
 * Required env vars:
 *   AIRTEL_CLIENT_ID       — from Airtel Africa Developer Portal
 *   AIRTEL_CLIENT_SECRET   — from Airtel Africa Developer Portal
 *   AIRTEL_ENV             — 'production' | 'sandbox' (default: sandbox)
 *   AIRTEL_COUNTRY         — ISO country code, e.g. 'KE' (default: KE)
 *   AIRTEL_CURRENCY        — ISO currency code, e.g. 'KES' (default: KES)
 *   AIRTEL_CALLBACK_URL    — HTTPS endpoint for Airtel to POST payment results
 */
import axios from 'axios'
import { redis } from '../db/redis'
import { logger } from '../util/logger'

const AIRTEL_BASE = process.env.AIRTEL_ENV === 'production'
  ? 'https://openapi.airtel.africa'
  : 'https://openapiuat.airtel.africa'

const COUNTRY  = process.env.AIRTEL_COUNTRY  ?? 'KE'
const CURRENCY = process.env.AIRTEL_CURRENCY ?? 'KES'
const REDIS_TOKEN_KEY = 'airtel:access_token'

export interface AirtelPaymentRequest {
  transactionId: string    // our internal txn ID (correlation)
  phone:         string    // consumer's Airtel number (254XXXXXXXXX or 07XXXXXXXX)
  amountCents:   number
  reference:     string    // shown on consumer's phone (max 20 chars)
}

export interface AirtelPaymentResult {
  success:       boolean
  transactionId: string    // Airtel's transaction ID
  errorMessage?: string
}

async function getAirtelToken(): Promise<string> {
  const cached = await redis.get(REDIS_TOKEN_KEY)
  if (cached) return cached

  const clientId     = process.env.AIRTEL_CLIENT_ID
  const clientSecret = process.env.AIRTEL_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Airtel credentials not configured — set AIRTEL_CLIENT_ID and AIRTEL_CLIENT_SECRET')
  }

  const response = await axios.post(`${AIRTEL_BASE}/auth/oauth2/token`, {
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'client_credentials',
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10_000,
  })

  const token:     string = response.data.access_token
  const expiresIn: number = response.data.expires_in ?? 3600

  await redis.setex(REDIS_TOKEN_KEY, expiresIn - 60, token)
  logger.info('Fetched new Airtel access token', { expiresIn })

  return token
}

export async function airtelCollect(req: AirtelPaymentRequest): Promise<AirtelPaymentResult> {
  const callbackUrl = process.env.AIRTEL_CALLBACK_URL
  if (!callbackUrl) {
    throw new Error('AIRTEL_CALLBACK_URL not configured')
  }

  const token     = await getAirtelToken()
  const amountKes = Math.ceil(req.amountCents / 100)
  const phone     = normaliseAirtelPhone(req.phone)

  logger.info('Initiating Airtel collection', {
    transactionId: req.transactionId,
    phone:         phone.slice(0, 6) + '****',
    amountKes,
  })

  const response = await axios.post(`${AIRTEL_BASE}/merchant/v2/payments/`, {
    reference:   req.reference.slice(0, 20),
    subscriber: {
      country:  COUNTRY,
      currency: CURRENCY,
      msisdn:   phone,
    },
    transaction: {
      amount:   amountKes,
      country:  COUNTRY,
      currency: CURRENCY,
      id:       req.transactionId,
    },
  }, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Country':    COUNTRY,
      'X-Currency':   CURRENCY,
    },
    timeout: 15_000,
  })

  const data   = response.data
  const status = data?.status?.code ?? data?.status?.message

  if (status !== 'DP00800001006' && data?.status?.success !== true) {
    logger.warn('Airtel collection failed', { response: data, transactionId: req.transactionId })
    return {
      success:       false,
      transactionId: req.transactionId,
      errorMessage:  data?.status?.message ?? 'Airtel collection failed',
    }
  }

  return {
    success:       true,
    transactionId: data?.data?.transaction?.id ?? req.transactionId,
  }
}

export async function airtelEnquiry(airtelTransactionId: string): Promise<{ status: string }> {
  const token = await getAirtelToken()

  const response = await axios.get(
    `${AIRTEL_BASE}/standard/v1/payments/${airtelTransactionId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Country':   COUNTRY,
        'X-Currency':  CURRENCY,
      },
      timeout: 10_000,
    }
  )

  return { status: response.data?.data?.transaction?.status ?? 'UNKNOWN' }
}

function normaliseAirtelPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('254') && digits.length === 12) return digits
  if (digits.startsWith('0')   && digits.length === 10) return '254' + digits.slice(1)
  if (digits.length === 9) return '254' + digits
  return digits
}
